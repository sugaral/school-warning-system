import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import Redis from 'ioredis';
import {
  isEmailConfigReady,
  normalizeEmailConfig,
  sendEmail,
} from '../shared/email.util';
import {
  normalizeSmsConfig,
  sendSms,
} from '../shared/sms.util';
import { renderTemplate } from '../shared/template.util';
import { buildFallbackNotificationContent } from '../shared/notification-content.util';
import { serializeForAudit } from '../shared/json.util';
import {
  clampNumber,
  isWarningEmailJob,
  isWarningJobStillActive,
  getWarningEmailThrottleDecision,
} from '../shared/notification-throttle.util';

const prisma = new PrismaClient();
const logger = pino({ name: 'notification-worker' });

/**
 * 冷却（频控）Redis 客户端（P1-1）
 *
 * worker 是独立进程，不走 Nest 依赖注入，因此这里直接建一个 ioredis 连接。
 * 复用与 API 相同的 REDIS_URL，保证两侧看到同一份冷却状态。
 */
const COOLDOWN_KEY_PREFIX = 'warn:notify:cooldown:';
const DEFAULT_COOLDOWN_HOURS = 24;
let cooldownRedis: Redis | null = null;

function getCooldownRedis(): Redis {
  if (!cooldownRedis) {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    cooldownRedis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    cooldownRedis.on('error', (err) => {
      logger.warn({ err: err.message }, '[通知任务Worker] 冷却 Redis 连接异常');
    });
  }
  return cooldownRedis;
}

/** 是否处于冷却期（应抑制发送）。Redis 故障时降级为 false，不阻断通知。 */
async function isCoolingDown(cooldownKey: string): Promise<boolean> {
  if (!cooldownKey) return false;
  try {
    const hit = await getCooldownRedis().get(`${COOLDOWN_KEY_PREFIX}${cooldownKey}`);
    return Boolean(hit);
  } catch (error: any) {
    logger.warn({ err: error?.message }, '[通知任务Worker] 读取冷却键失败，跳过频控');
    return false;
  }
}

/**
 * 写入冷却键 —— **只在发送成功后调用**。
 * 顺序颠倒会导致发送失败的消息在整个冷却窗口被静默、永久丢失。
 */
async function markCooldown(job: any): Promise<void> {
  const cooldownKey = String(job?.cooldown_key || '');
  if (!cooldownKey) return;
  const raw = Number(job?.cooldown_hours);
  const hours = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 24 * 30) : DEFAULT_COOLDOWN_HOURS;
  try {
    await getCooldownRedis().set(
      `${COOLDOWN_KEY_PREFIX}${cooldownKey}`,
      String(Date.now()),
      'EX',
      Math.max(60, Math.round(hours * 60 * 60)),
    );
  } catch (error: any) {
    logger.warn({ err: error?.message }, '[通知任务Worker] 写入冷却键失败');
  }
}

async function loadSystemConfig(key: string, defaultValue: any = null) {
  const row = await prisma.system_settings.findUnique({
    where: { setting_key: key },
  });
  if (!row) {
    return defaultValue;
  }

  try {
    return JSON.parse(row.setting_val);
  } catch {
    return row.setting_val;
  }
}


async function markWorkerJobFailedOrRetry(job: any, errorMessage: string) {
  const nextTryCount = Number(job?.try_count || 0) + 1;
  const safeError = String(errorMessage || 'dispatch_failed').slice(0, 255);
  if (nextTryCount < 3) {
    const backoffMs = Math.pow(2, nextTryCount) * 30_000;
    await prisma.notification_jobs.update({
      where: { id: job.id },
      data: {
        status: 'queued',
        try_count: { increment: 1 },
        schedule_at: new Date(Date.now() + backoffMs),
        updated_at: new Date(),
        last_error: safeError,
      },
    });
    return;
  }

  await prisma.notification_jobs.update({
    where: { id: job.id },
    data: {
      status: 'failed',
      try_count: { increment: 1 },
      updated_at: new Date(),
      last_error: safeError,
    },
  });
}

async function processNotificationJobs() {
  logger.info('[通知任务Worker] 开始处理通知任务');

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  await Promise.all([
    prisma.notification_jobs.updateMany({
      where: {
        status: 'running',
        updated_at: { lt: staleBefore },
        try_count: { lt: 3 },
      },
      data: {
        status: 'queued',
        schedule_at: new Date(),
        updated_at: new Date(),
        last_error: 'running_lease_recovered',
      },
    }),
    prisma.notification_jobs.updateMany({
      where: {
        status: 'running',
        updated_at: { lt: staleBefore },
        try_count: { gte: 3 },
      },
      data: {
        status: 'failed',
        updated_at: new Date(),
        last_error: 'running_lease_timeout',
      },
    }),
  ]);

  const jobs = await prisma.notification_jobs.findMany({
    where: {
      status: 'queued',
      OR: [{ schedule_at: null }, { schedule_at: { lte: new Date() } }],
    },
    take: 100,
    orderBy: { created_at: 'asc' },
  });

  logger.info({ jobCount: jobs.length }, '[通知任务Worker] 待处理任务数');

  let successCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let suppressedCount = 0;

  for (const job of jobs) {
    try {
      const claimResult = await prisma.notification_jobs.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'running', updated_at: new Date() },
      });

      if (claimResult.count === 0) {
        continue;
      }

      if (isWarningEmailJob(job) && !(await isWarningJobStillActive(prisma, job))) {
        await prisma.notification_jobs.update({
          where: { id: job.id },
          data: { status: 'cancelled', last_error: 'warning_state_not_active' },
        });
        cancelledCount++;
        continue;
      }

      // P1-1：真实频控。
      // 修复前这里是死代码 —— 它按 `job_id: job.id` 查本任务自己的日志，
      // 而此刻该任务尚未发送，永远查不到，冷却分支永不生效。
      // 正确做法：查 Redis 冷却键（发送成功后才写入）。
      if (job.cooldown_key) {
        const cooling = await isCoolingDown(String(job.cooldown_key));
        if (cooling) {
          await prisma.notification_jobs.update({
            where: { id: job.id },
            data: {
              status: 'suppressed',
              schedule_at: null,
              last_error: 'cooldown_active',
            },
          });
          suppressedCount++;
          continue;
        }
      }

      // 先按本渠道查模板（email/sms/wechat 各自有版本）
      const baseTemplate = job.template_code
        ? await prisma.message_templates.findFirst({
            where: {
              template_code: job.template_code,
              channel: job.channel,
              status: 'active',
            },
          })
        : null;

      const params = (job.params_json as Record<string, any>) || {};

      // ----------------------------------------------------------------
      // 模板查找：先按本渠道，再退回 email 渠道的同一 template_code。
      //
      // 为什么需要退回：模板是按 (channel, template_code) 唯一的，
      // 而 `app`（站内信）渠道**没有**配套模板 —— 随包发布的
      // WARNING_NOTIFICATION 只有 email / sms / wechat 三个渠道的版本。
      // 若只按 channel='app' 查，必然查不到，于是走到下面的兜底分支。
      // ----------------------------------------------------------------
      const template =
        baseTemplate ??
        (job.template_code
          ? await prisma.message_templates.findFirst({
              where: {
                template_code: job.template_code,
                channel: 'email',
                status: 'active',
              },
            })
          : null);

      // ----------------------------------------------------------------
      // 兜底文案：**绝不能**再用 JSON.stringify(params)。
      //
      // 实测故障（本次修复前）：app 渠道因查不到模板而落到
      //   content = JSON.stringify(params)
      // 学生收到的站内消息是：
      //   {"email":"loadtest1987@loadtest.local","level":"yellow","metric":"absent",...
      // 既暴露了内部字段（邮箱、student_id、cooldown 等），又完全不可读。
      // 这是一条会真实进入学生视野的路径，必须给人类可读的中文文案。
      // ----------------------------------------------------------------
      const content = template
        ? renderTemplate(template.content, params)
        : buildFallbackContent(params);
      const title = template?.title ? renderTemplate(template.title, params) : '系统通知';

      const sendResult = await sendNotification(job, {
        subject: title,
        content,
      }, params);

      if (
        !sendResult.success &&
        sendResult.error === 'hourly_email_limit_exceeded' &&
        sendResult.scheduleAt
      ) {
        logger.warn(
          { jobId: job.id.toString(), scheduleAt: sendResult.scheduleAt.toISOString() },
          '[通知任务Worker] 预警邮件触发小时限流，任务已延后重试',
        );
        continue;
      }

      const receivers = (job.receivers_json as any[]) || [];
      for (const receiver of receivers) {
        await prisma.notification_logs.create({
          data: {
            job_id: job.id,
            channel: job.channel,
            receiver:
              receiver.openid ||
              receiver.mobile ||
              receiver.email ||
              // app 渠道的接收人是 users.id，日志里要能看出是谁
              (receiver.user_id ? `user:${receiver.user_id}` : '') ||
              receiver.name ||
              receiver.id ||
              '',
            content_snapshot: content,
            send_status: sendResult.success ? 'success' : 'failed',
            provider: sendResult.provider,
            provider_msg_id: sendResult.msgId,
            error_msg: sendResult.error,
            sent_at: new Date(),
            acknowledged: false,
          },
        });
      }

      // ⚠️ 顺序至关重要（P1-1）：先确认发送成功，再写冷却键。
      // 反过来会让"发送失败"也被冷却，消息永久丢失。
      if (sendResult.success) {
        await markCooldown(job);
      }

      if (sendResult.success) {
        await prisma.notification_jobs.update({
          where: { id: job.id },
          data: {
            status: 'completed',
            schedule_at: null,
            try_count: { increment: 1 },
            updated_at: new Date(),
            last_error: sendResult.error,
          },
        });
        successCount++;
      } else {
        await markWorkerJobFailedOrRetry(job, sendResult.error || 'send_failed');
        failedCount++;
      }
    } catch (error: any) {
      logger.error({ err: error, jobId: job.id.toString() }, `[通知任务Worker] 任务处理失败`);
      failedCount++;

      await markWorkerJobFailedOrRetry(job, error?.message || 'worker_exception');
    }
  }

  const result = {
    jobs_found: jobs.length,
    success_count: successCount,
    failed_count: failedCount,
    cancelled_count: cancelledCount,
    suppressed_count: suppressedCount,
  };

  await prisma.audit_logs.create({
    data: {
      actor_user_id: 0n,
      action: 'notification.process_jobs',
      entity_type: 'notification_job',
      entity_id: 0n,
      after_json: serializeForAudit(result) as any,
      ip: '',
      user_agent: 'system',
    },
  });

  logger.info(result, '[通知任务Worker] 本轮处理完成');
}

/**
 * 无模板时的人类可读兜底文案
 *
 * 实现已抽到 shared/notification-content.util.ts，与 API 侧派发
 * （notification-dispatch.service.ts）共用同一份，避免两处再次漂移。
 * 修复前的兜底是 `JSON.stringify(params)`，会把 email / student_id
 * 等内部字段直接展示给学生。
 */
function buildFallbackContent(params: Record<string, any>): string {
  return buildFallbackNotificationContent(params);
}

async function sendNotification(
  job: any,
  payload: {
    subject: string;
    content: string;
  },
  /**
   * 渲染参数（job.params_json）。
   * app 渠道需要它来决定站内消息的 type（warning_red / class_notice / system），
   * 因此显式传入而不从 job 里再取一次。
   */
  params?: Record<string, any>,
): Promise<{ success: boolean; provider?: string; msgId?: string; error?: string; scheduleAt?: Date | null }> {
  const channel = String(job?.channel || '').toLowerCase();
  const receivers = (job?.receivers_json as any[]) || [];
  logger.info({ channel, receiverCount: receivers.length }, `[通知任务Worker] 开始发送通知`);

  switch (channel) {
    case 'wechat':
      return {
        success: false,
        provider: 'wechat_unconfigured',
        error: 'wechat channel is not configured',
      };

    case 'sms':
      {
        const smsConfig = normalizeSmsConfig(await loadSystemConfig('sms', {}));
        const smsTargets = receivers
          .map((item) => String(item.mobile || item.phone || '').trim())
          .filter(Boolean);

        if (smsTargets.length === 0) {
          return {
            success: false,
            error: 'no_sms_receivers',
          };
        }

        const result = await sendSms(smsConfig, {
          mobiles: smsTargets,
          content: payload.content,
          templateCode: '',
          params: {},
        });

        return {
          success: result.success,
          provider: result.provider,
          msgId: result.msgId,
          error: result.error,
        };
      }

    case 'email': {
      if (isWarningEmailJob(job)) {
        const rawWarningConfig = await loadSystemConfig('warning', {});
        const maxPerHour = clampNumber(rawWarningConfig?.maxWarningEmailsPerHour, 60, 1, 5000);
        const throttleDecision = await getWarningEmailThrottleDecision(prisma, maxPerHour);
        if (throttleDecision.limited) {
          await prisma.notification_jobs.update({
            where: { id: job.id },
            data: {
              status: 'queued',
              schedule_at: throttleDecision.nextScheduleAt,
              last_error: 'hourly_email_limit_exceeded',
            },
          });
          return {
            success: false,
            error: 'hourly_email_limit_exceeded',
            scheduleAt: throttleDecision.nextScheduleAt,
          };
        }
      }

      const notificationConfig =
        (await loadSystemConfig('email', null)) ??
        (await loadSystemConfig('notification', {}));
      const emailConfig = normalizeEmailConfig(notificationConfig);
      if (!isEmailConfigReady(emailConfig)) {
        return {
          success: false,
          error: 'email_config_not_ready',
        };
      }
      const emailTargets = receivers
        .map((item) => String(item.email || '').trim())
        .filter(Boolean);

      if (emailTargets.length === 0) {
        return {
          success: false,
          error: 'no_email_receivers',
        };
      }

      const result = await sendEmail(emailConfig, {
        to: emailTargets,
        subject: payload.subject,
        text: payload.content,
        html: payload.content.replace(/\n/g, '<br />'),
      });

      return {
        success: true,
        provider: emailConfig.provider || 'smtp',
        msgId: result.messageId || undefined,
      };
    }

    case 'app': {
      // ----------------------------------------------------------------
      // 站内信（复活僵尸表 `notification`）
      //
      // 这是**唯一不需要任何外部配置**的渠道：不依赖 SMTP、短信网关、
      // 微信凭据。本项目默认没有配置任何外部渠道，所以站内信是
      // "预警一定可达学生"的兜底路径。
      //
      // 与 email/sms 的差异：不是"发送"，而是落库 + 学生端拉取
      // （GET /student/inbox，见 shared/notification-center.service.ts）。
      // ----------------------------------------------------------------
      const userIds = receivers
        .map((item) => item?.user_id)
        .filter((id) => id !== null && id !== undefined && String(id).trim() !== '');

      if (userIds.length === 0) {
        return { success: false, error: 'no_app_receivers' };
      }

      const level = String(params?.level || params?.warning_level || '')
        .trim()
        .toLowerCase();
      const notifType = ['yellow', 'orange', 'red', 'severe'].includes(level)
        ? `warning_${level}`
        : 'system';

      let written = 0;
      for (const userId of userIds) {
        try {
          await prisma.notification.create({
            data: {
              user_id: BigInt(String(userId)),
              type: notifType,
              content: payload.content,
              status: 'unread',
            },
          });
          written += 1;
        } catch (writeError: any) {
          logger.warn(
            { err: writeError, jobId: job.id.toString(), userId: String(userId) },
            '[通知任务Worker] 站内信写入失败',
          );
        }
      }

      // 一条都没写成功就必须失败 —— 绝不能伪装成功（P0-2 的核心约束）
      if (written === 0) {
        return { success: false, error: 'app_write_failed' };
      }

      return {
        success: true,
        provider: 'notification_center',
      };
    }

    default:
      return {
        success: false,
        error: `unsupported_channel:${channel}`,
      };
  }
}

async function main() {
  logger.info('[通知任务Worker] 启动');
  await processNotificationJobs();
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((error) => {
    logger.error({ err: error }, '[通知任务Worker] 启动失败');
    process.exit(1);
  });
}

export { processNotificationJobs };
