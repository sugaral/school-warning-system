import { Prisma, PrismaClient } from '@prisma/client';
import pino from 'pino';
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
import { serializeForAudit } from '../shared/json.util';

const prisma = new PrismaClient();
const logger = pino({ name: 'notification-worker' });
const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];

type WarningEmailQuotaRow = {
  sent_count: bigint | number | string | null;
  oldest_sent_at: Date | string | null;
};

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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isWarningEmailJob(job: any) {
  return (
    String(job?.channel || '').trim().toLowerCase() === 'email' &&
    (job?.warning_id !== null && job?.warning_id !== undefined
      || ['rule', 'config'].includes(String(job?.trigger_type || '').trim().toLowerCase()))
  );
}

function getCourseKey(courseId?: bigint | number | string | null) {
  return courseId ? String(courseId) : '__none__';
}

async function isWarningJobStillActive(job: any) {
  if (!job?.warning_id) {
    return true;
  }

  const historyWarning = await prisma.warnings.findUnique({
    where: { id: job.warning_id },
    select: {
      id: true,
      student_id: true,
      metric: true,
      level: true,
      window: true,
      period_start: true,
      period_end: true,
      course_id: true,
    },
  });

  if (!historyWarning) {
    return false;
  }

  const currentState = await (prisma as any).warning_current_states.findFirst({
    where: {
      student_id: historyWarning.student_id,
      metric: historyWarning.metric,
      level: historyWarning.level,
      window: historyWarning.window,
      period_start: historyWarning.period_start,
      period_end: historyWarning.period_end,
      course_key: getCourseKey(historyWarning.course_id || null),
      status: { in: ACTIVE_WARNING_STATUSES },
    },
    select: { id: true },
  });

  return Boolean(currentState);
}

async function getWarningEmailThrottleDecision() {
  const rawWarningConfig = await loadSystemConfig('warning', {});
  const maxPerHour = clampNumber(rawWarningConfig?.maxWarningEmailsPerHour, 60, 1, 5000);
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<WarningEmailQuotaRow[]>(Prisma.sql`
    SELECT
      COUNT(*) AS sent_count,
      MIN(nl.sent_at) AS oldest_sent_at
    FROM notification_logs nl
    INNER JOIN notification_jobs nj ON nj.id = nl.job_id
    WHERE nl.channel = 'email'
      AND nl.send_status = 'success'
      AND nl.sent_at >= ${since}
      AND (nj.warning_id IS NOT NULL OR nj.trigger_type IN ('rule', 'config'))
  `);

  const row = rows[0] || { sent_count: 0, oldest_sent_at: null };
  const sentCount = Number(row.sent_count || 0);
  const oldestSentAt = row.oldest_sent_at ? new Date(row.oldest_sent_at) : null;

  if (sentCount < maxPerHour) {
    return {
      limited: false,
      nextScheduleAt: null as Date | null,
    };
  }

  const nextScheduleAt = oldestSentAt && !Number.isNaN(oldestSentAt.getTime())
    ? new Date(oldestSentAt.getTime() + 60 * 60 * 1000 + 5_000)
    : new Date(Date.now() + 5 * 60 * 1000);

  return {
    limited: true,
    nextScheduleAt,
  };
}

async function processNotificationJobs() {
  logger.info('[通知任务Worker] 开始处理通知任务');

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

  for (const job of jobs) {
    try {
      const claimResult = await prisma.notification_jobs.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'running' },
      });

      if (claimResult.count === 0) {
        continue;
      }

      if (isWarningEmailJob(job) && !(await isWarningJobStillActive(job))) {
        await prisma.notification_jobs.update({
          where: { id: job.id },
          data: { status: 'cancelled', last_error: 'warning_state_not_active' },
        });
        cancelledCount++;
        continue;
      }

      if (job.cooldown_key) {
        const recentLog = await prisma.notification_logs.findFirst({
          where: {
            job_id: job.id,
            sent_at: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        });

        if (recentLog) {
          await prisma.notification_jobs.update({
            where: { id: job.id },
            data: { status: 'cancelled' },
          });
          cancelledCount++;
          continue;
        }
      }

      const template = job.template_code
        ? await prisma.message_templates.findFirst({
            where: {
              template_code: job.template_code,
              channel: job.channel,
              status: 'active',
            },
          })
        : null;

      const params = (job.params_json as Record<string, any>) || {};
      const content = template
        ? renderTemplate(template.content, params)
        : JSON.stringify(params || {});
      const title = template?.title
        ? renderTemplate(template.title, params)
        : '系统通知';

      const sendResult = await sendNotification(job, {
        subject: title,
        content,
      });

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

      await prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: sendResult.success ? 'completed' : 'failed',
          schedule_at: sendResult.success ? null : job.schedule_at,
          try_count: { increment: 1 },
          last_error: sendResult.error,
        },
      });

      if (sendResult.success) {
        successCount++;
      } else {
        failedCount++;
      }
    } catch (error: any) {
      logger.error({ err: error, jobId: job.id.toString() }, `[通知任务Worker] 任务处理失败`);
      failedCount++;

      await prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: error.message,
        },
      });
    }
  }

  const result = {
    jobs_found: jobs.length,
    success_count: successCount,
    failed_count: failedCount,
    cancelled_count: cancelledCount,
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

async function sendNotification(
  job: any,
  payload: {
    subject: string;
    content: string;
  },
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
        const throttleDecision = await getWarningEmailThrottleDecision();
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
