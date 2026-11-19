import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { ConfigService as SystemConfigService } from '../config/config.service';
import { isEmailConfigReady, normalizeEmailConfig, sendEmail } from '../shared/email.util';
import { isSmsConfigReady, normalizeSmsConfig } from '../shared/sms.util';
import { renderTemplate } from '../shared/template.util';
import { NotificationCenterService } from '../shared/notification-center.service';
import { buildFallbackNotificationContent } from '../shared/notification-content.util';
import {
  QuietHoursDecision,
  canBreakThroughQuietHours,
  channelMustRespectQuietHours,
  isWithinQuietHours,
  resolveQuietHoursDecision,
} from '../shared/quiet-hours.util';
import {
  clampNumber,
  isWarningEmailJob,
  isWarningJobStillActive,
  getWarningEmailThrottleDecision,
} from '../shared/notification-throttle.util';

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private readonly lockKey = 'lock:notification-dispatch';
  private readonly lockTtlMs = 20_000;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly systemConfigService: SystemConfigService,
    // 站内信（app 渠道）投递：写 notification 表
    private readonly notificationCenter: NotificationCenterService,
  ) {}

  @Cron('*/5 * * * * *', { timeZone: 'Asia/Shanghai' })
  async processQueuedJobs() {
    // P0-3：API 容器是否参与「通知任务表队列」消费由开关控制。
    // 默认 true（保持既有单容器行为）；当独立 worker 容器启用后，
    // 部署时把 API 侧设为 false，避免 API 与 worker 重复消费同一批任务。
    if (!this.isDispatchEnabled()) {
      return;
    }

    if (this.processing) {
      return;
    }

    // P1-3：多副本下必须用 Redis 分布式锁串行化，否则同一批 queued 任务
    // 会被多个实例同时领取。此前 lockKey 已声明但从未使用（死代码）。
    let lockToken: string | null = null;
    try {
      lockToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      let locked = false;
      try {
        locked = await this.redis.acquireLock(this.lockKey, this.lockTtlMs, lockToken);
      } catch (error: any) {
        // Redis 不可用时不阻塞派发（降级为无锁，仍由 DB CAS 兜底）
        this.logger.warn(
          `[通知派发] 获取分布式锁失败，降级为无锁运行：${error?.message || error}`,
        );
        locked = true;
        lockToken = null;
      }
      if (!locked) {
        return; // 其他实例正在派发，本轮直接跳过
      }

      this.processing = true;
      const batchSize = Math.min(
        20,
        Math.max(1, Number(process.env.NOTIFICATION_JOB_BATCH_SIZE || 8)),
      );
      const jobs = await this.prisma.notification_jobs.findMany({
        where: {
          status: 'queued',
          OR: [{ schedule_at: null }, { schedule_at: { lte: new Date() } }],
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: batchSize,
      });

      for (const job of jobs) {
        await this.processSingleJob(job);
      }
    } finally {
      this.processing = false;
      if (lockToken) {
        await this.redis.releaseLock(this.lockKey, lockToken).catch(() => undefined);
      }
    }
  }

  /** API 容器是否消费通知任务队列（独立 worker 部署时应置 false） */
  private isDispatchEnabled(): boolean {
    const raw = process.env.NOTIFICATION_DISPATCH_ENABLED;
    if (raw === undefined || raw === '') return true;
    return String(raw).toLowerCase() !== 'false';
  }

  private async processSingleJob(job: any) {
    try {
      const claimResult = await this.prisma.notification_jobs.updateMany({
        where: { id: job.id, status: 'queued' },
        data: {
          status: 'running',
        },
      });

      if (claimResult.count === 0) {
        return;
      }

      if (isWarningEmailJob(job) && !(await isWarningJobStillActive(this.prisma, job))) {
        await this.prisma.notification_jobs.update({
          where: { id: job.id },
          data: {
            status: 'cancelled',
            last_error: 'warning_state_not_active',
          },
        });
        return;
      }

      // 先按本渠道查模板；app（站内信）没有配套模板，需退回 email 版本
      const template =
        (job.template_code
          ? await this.prisma.message_templates.findFirst({
              where: {
                template_code: job.template_code,
                channel: job.channel,
                status: 'active',
              },
            })
          : null) ??
        (job.template_code
          ? await this.prisma.message_templates.findFirst({
              where: {
                template_code: job.template_code,
                channel: 'email',
                status: 'active',
              },
            })
          : null);

      const params = (job.params_json as Record<string, any>) || {};
      const subject = template?.title ? renderTemplate(template.title, params) : '系统通知';
      // 兜底改为人类可读中文：原先是 JSON.stringify(params)，
      // app 渠道因缺模板必然走到这里，会把内部字段直接展示给学生
      const content = template?.content
        ? renderTemplate(template.content, params)
        : buildFallbackNotificationContent(params);

      const channel = String(job.channel || '').toLowerCase();

      // P1-1：真实的频控检查。
      // cooldown_key 现在由 warning.service.ts 在创建任务时写入，
      // 键为 {studentId}:{level}:{ruleId}:{periodStart}。
      // 冷却键只在**发送成功之后**才写入（见 markCooldown），
      // 因此"发送失败"不会被冷却，消息不会永久丢失。
      if (job.cooldown_key && (await this.isCoolingDown(String(job.cooldown_key)))) {
        await this.prisma.notification_jobs.update({
          where: { id: job.id },
          data: {
            status: 'suppressed',
            schedule_at: null,
            last_error: 'cooldown_active',
          },
        });
        this.logger.log(
          `[通知派发] 任务 ${job.id.toString()} 命中频控（key=${job.cooldown_key}），已抑制发送`,
        );
        return;
      }

      // P1-2：静默时段（quiet hours）。
      // 修复前全仓库搜索 quiet/静默/免打扰 **0 命中** —— 该功能完全不存在，
      // 而 seed 已经把 quiet_hours 写进 student_profiles.notify_prefs_json，
      // 属于"只存不用"。这里在派发前判定，命中则把任务推迟到静默结束。
      const quietDecision = await this.resolveQuietHoursForJob(job, channel);
      if (quietDecision.quiet && quietDecision.resumeAt) {
        await this.prisma.notification_jobs.update({
          where: { id: job.id },
          data: {
            status: 'queued',
            schedule_at: quietDecision.resumeAt,
            last_error: `quiet_hours_active(${quietDecision.source || 'default'})`,
          },
        });
        this.logger.log(
          `[通知派发] 任务 ${job.id.toString()} 处于静默期，推迟至 ${quietDecision.resumeAt.toISOString()}`,
        );
        return;
      }

      if (channel === 'email') {
        await this.sendEmailJob(job, subject, content);
      } else if (channel === 'app') {
        // 站内信已实现（notification 表 + /student/inbox），走真实投递
        await this.sendAppJob(job, content);
      } else {
        // P0-2 修复：未实现/未配置的渠道绝不再写 send_status='success'。
        await this.deferUnsupportedChannel(job, content, channel);
      }
    } catch (error: any) {
      this.logger.error(
        `[通知派发] 任务 ${job.id.toString()} 失败`,
        error?.stack || error?.message || String(error),
      );
      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: error?.message || 'dispatch_failed',
        },
      });
    }
  }

  /**
   * 站内信投递（app 渠道）
   *
   * 与 email 的差异：
   *   - 不需要任何外部配置，因此**永远可用**。这很重要 ——
   *     本项目默认没有 SMTP/短信网关，若只依赖 email/sms，
   *     学生实际上收不到任何提醒；站内信保证"系统里一定看得到"。
   *   - 不是真正意义上的"发送"，而是落库：写 notification 表，
   *     学生端 /student/inbox 读取。
   *
   * 仍严格遵守 P0-2：只有**确实写入成功**才记 send_status='success'；
   * 没有可投递的 user_id 时记 failed（而不是伪装成功）。
   */
  private async sendAppJob(job: any, content: string) {
    const receivers = Array.isArray(job.receivers_json) ? job.receivers_json : [];
    const userIds = receivers
      .map((item: any) => item?.user_id)
      .filter((id: any) => id !== null && id !== undefined && String(id).trim() !== '');

    if (userIds.length === 0) {
      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: 'no_app_receivers',
        },
      });
      return;
    }

    // 写站内信：正文与日志快照保持一致
    let written = 0;
    for (const userId of userIds) {
      const ok = await this.notificationCenter.createForUser(
        userId,
        NotificationCenterService.typeForWarningLevel(
          String(job?.params_json?.level || job?.params_json?.warning_level || ''),
        ),
        content,
      );
      if (ok) written += 1;
    }

    const sentAt = new Date();

    if (written === 0) {
      // 一条都没写成功 —— 必须记 failed，不能记 success（P0-2 的核心约束）
      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: 'app_write_failed',
        },
      });
      return;
    }

    await this.prisma.notification_logs.createMany({
      data: receivers.map((receiver: any) => ({
        job_id: job.id,
        channel: 'app',
        receiver: String(receiver?.name || receiver?.user_id || receiver?.student_id || ''),
        content_snapshot: content,
        send_status: 'success',
        provider: 'notification_center',
        sent_at: sentAt,
        acknowledged: false,
      })),
    });

    // ⚠️ 顺序与 email 路径一致（P1-1）：必须先投递成功，再写冷却键。
    // 先写冷却会导致"发送失败也进入冷却"，消息在该窗口内永久丢失。
    await this.markCooldown(job);

    await this.prisma.notification_jobs.update({
      where: { id: job.id },
      data: {
        // 与 email 路径保持一致：'completed' 而非 'sent'
        // （notification_jobs 表没有 sent_at 列，投递时间记在 notification_logs.sent_at）
        status: 'completed',
        schedule_at: null,
        last_error: null,
      },
    });

    this.logger.log(
      `[通知派发] 站内信投递成功，任务=${job.id.toString()}，写入 ${written}/${userIds.length} 条`,
    );
  }

  private async sendEmailJob(job: any, subject: string, content: string) {
    const receivers = Array.isArray(job.receivers_json) ? job.receivers_json : [];
    const emailTargets = receivers
      .map((item: any) => String(item?.email || '').trim().toLowerCase())
      .filter(Boolean);

    if (emailTargets.length === 0) {
      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: 'no_email_receivers',
        },
      });
      return;
    }

    if (isWarningEmailJob(job)) {
      const rawWarningConfig = await this.systemConfigService.getConfig('warning', {});
      const maxPerHour = clampNumber(rawWarningConfig?.maxWarningEmailsPerHour, 60, 1, 5000);
      const throttleDecision = await getWarningEmailThrottleDecision(this.prisma, maxPerHour);
      if (throttleDecision.limited) {
        await this.prisma.notification_jobs.update({
          where: { id: job.id },
          data: {
            status: 'queued',
            schedule_at: throttleDecision.nextScheduleAt,
            last_error: 'hourly_email_limit_exceeded',
          },
        });
        this.logger.warn(
          `[通知派发] 预警邮件触发小时限流，任务=${job.id.toString()} 已延后至 ${throttleDecision.nextScheduleAt?.toISOString?.() || 'later'}`,
        );
        return;
      }
    }

    const notificationConfig = await this.systemConfigService.getSectionConfig('email', {}, ['notification']);
    const emailConfig = normalizeEmailConfig(notificationConfig);
    if (!isEmailConfigReady(emailConfig)) {
      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: 'email_config_not_ready',
        },
      });
      return;
    }

    const result = await sendEmail(emailConfig, {
      to: emailTargets,
      subject,
      text: content,
      html: content.replace(/\n/g, '<br />'),
    });

    const sentAt = new Date();
    const logEntries = emailTargets.map((email: string) => ({
      job_id: job.id,
      channel: 'email',
      receiver: email,
      content_snapshot: content,
      send_status: 'success',
      provider: emailConfig.provider || 'smtp',
      provider_msg_id: result.messageId || null,
      sent_at: sentAt,
      acknowledged: false,
    }));
    if (logEntries.length > 0) {
      await this.prisma.notification_logs.createMany({ data: logEntries });
    }

    // ⚠️ 顺序至关重要（P1-1）：必须**先发送成功，再写冷却键**。
    // 若先写冷却再发送，一旦发送失败，该预警会在整个冷却窗口内被静默，
    // 消息永久丢失。
    await this.markCooldown(job);

    await this.prisma.notification_jobs.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        schedule_at: null,
        try_count: { increment: 1 },
        last_error: null,
      },
    });
  }

  // ============================================================
  // P1-1 频控（cooldown）实现
  // ============================================================

  /** Redis 冷却键前缀 */
  private readonly cooldownKeyPrefix = 'warn:notify:cooldown:';
  /** 冷却小时数默认值（无规则配置时） */
  private readonly defaultCooldownHours = 24;

  /** 冷却键是否仍然有效（即当前处于冷却期，应抑制发送） */
  private async isCoolingDown(cooldownKey: string): Promise<boolean> {
    if (!cooldownKey) return false;
    try {
      const hit = await this.redis.get(`${this.cooldownKeyPrefix}${cooldownKey}`);
      return Boolean(hit);
    } catch (error: any) {
      // Redis 故障时不应阻断通知（降级为不频控）
      this.logger.warn(`[通知派发] 读取频控键失败，跳过频控：${error?.message || error}`);
      return false;
    }
  }

  /**
   * 写入冷却键。**只在发送成功后调用**。
   * TTL 必设（编码铁律 19：Redis 每个 key 都必须有 TTL）。
   *
   * 冷却时长来源：任务自身的 params/规则通知策略。此处用默认值，
   * 具体小时数可在 warning.service 创建任务时按 notify_strategy_json 覆盖。
   */
  private async markCooldown(job: any) {
    const cooldownKey = String(job?.cooldown_key || '');
    if (!cooldownKey) return;

    const hours = this.resolveCooldownHours(job);
    const ttlSeconds = Math.max(60, Math.round(hours * 60 * 60));

    try {
      await this.redis.set(
        `${this.cooldownKeyPrefix}${cooldownKey}`,
        String(Date.now()),
        'EX',
        ttlSeconds,
      );
    } catch (error: any) {
      this.logger.warn(`[通知派发] 写入频控键失败：${error?.message || error}`);
    }
  }

  /** 解析冷却小时数：任务携带优先，其次默认 24h，上限 30 天 */
  private resolveCooldownHours(job: any): number {
    const raw = Number(job?.cooldown_hours ?? job?.params_json?.cooldown_hours);
    if (!Number.isFinite(raw) || raw < 0) {
      return this.defaultCooldownHours;
    }
    return Math.min(raw, 24 * 30);
  }

  // ============================================================
  // P1-2 静默时段
  // ============================================================

  /**
   * 解析该任务是否落在静默期。
   *
   * 优先级（对齐 §6.4 第 4 条）：
   *  1. 学生个人偏好 `student_profiles.notify_prefs_json.quiet_hours`（最重要）
   *  2. 预警规则 `notify_strategy_json.quiet_hours`
   *  3. 系统默认静默时段（22:00-08:00，符合高校作息）
   *
   * 例外：red / severe 强制突破（见 quiet-hours.util 的
   * canBreakThroughQuietHours），避免严重风险被免打扰挡住。
   *
   * 只有"打扰型渠道"（sms / wechat / wecom）才需要遵守静默期；
   * email / app(站内信) 不打扰用户，可随时抵达。
   */
  private async resolveQuietHoursForJob(
    job: any,
    channel: string,
  ): Promise<QuietHoursDecision> {
    if (!channelMustRespectQuietHours(channel)) {
      return { quiet: false, resumeAt: null, source: null };
    }

    const params = (job?.params_json as Record<string, any>) || {};
    const level = params.level ?? params.warning_level;

    // red / severe 提前短路，避免无谓查库
    if (canBreakThroughQuietHours(level)) {
      return { quiet: false, resumeAt: null, source: null };
    }

    // 取学生个人偏好
    let personalPrefs: any = null;
    try {
      const studentId = await this.resolveStudentIdForJob(job);
      if (studentId) {
        const profile = await this.prisma.student_profiles.findUnique({
          where: { id: studentId },
          select: { notify_prefs_json: true },
        });
        personalPrefs = profile?.notify_prefs_json ?? null;
      }
    } catch {
      personalPrefs = null;
    }

    // 取规则通知策略（经 warnings.notification_jobs → 由参数携带或留空）
    const strategy = params.notify_strategy_json ?? null;

    // 都没有配置时，使用系统默认静默时段（高校作息）
    const decision = resolveQuietHoursDecision({
      now: new Date(),
      level,
      personalPrefs,
      strategy,
    });
    if (decision.source) {
      return decision;
    }

    const { quiet, resumeAt } = isWithinQuietHours(new Date(), {
      start: this.defaultQuietHours.start,
      end: this.defaultQuietHours.end,
    });
    return { quiet, resumeAt, source: quiet ? 'default' : null };
  }

  /** 系统默认静默时段 */
  private readonly defaultQuietHours = { start: '22:00', end: '08:00' };

  /** 由任务反查学生档案 id（优先 receivers_json，其次 warning_id） */
  private async resolveStudentIdForJob(job: any): Promise<bigint | null> {
    const receivers = Array.isArray(job?.receivers_json) ? job.receivers_json : [];
    for (const r of receivers) {
      if (r?.student_id !== undefined && r?.student_id !== null && r?.student_id !== '') {
        try {
          return BigInt(String(r.student_id));
        } catch {
          /* 继续尝试下一个来源 */
        }
      }
    }

    if (job?.warning_id) {
      const warning = await this.prisma.warnings.findUnique({
        where: { id: BigInt(String(job.warning_id)) },
        select: { student_id: true },
      });
      return warning?.student_id ?? null;
    }

    return null;
  }

  /**
   * P0-2 修复：处理「尚未实现 / 未配置」的通知渠道。
   *
   * 缺陷原文（修复前）：本方法名为 completeUnsupportedChannel，对 email 以外的
   * 所有渠道（wechat / sms / wecom / app）直接写
   *   notification_logs.send_status = 'success', provider = 'deferred'
   * 并把任务置为 completed —— 即「根本没发，却记为发送成功」。
   * 管理端通知中心与审计报表会把它显示为成功，直接误导使用者。
   *
   * 修复原则：**任何未真实投递的消息都不得记为 success**。
   * - 每个 receiver 仍写一条 notification_logs（保留可追溯性）；
   * - send_status 记为 'deferred'（未配置、未发送），
   *   语义上明确区别于 'success'，同时区别于 'failed'（尝试发送但失败）；
   * - error_msg 写明原因（channel_not_implemented / channel_not_configured）；
   * - 任务状态记为 'deferred'，retry_count 不递增（这不是失败重试场景），
   *   并清空 schedule_at 以免被反复重扫。
   *
   * 渠道可用性判定：
   * - email   : 已实现（nodemailer），由 sendEmailJob 处理；
   * - sms     : 已实现通用 HTTP 网关（shared/sms.util.ts），但需在
   *             系统配置中填写网关后方可用；
   * - app     : **已实现** —— 站内信写 notification 表，由 sendAppJob 处理，
   *             学生端通过 GET /student/inbox 读取（见 notification-center.service.ts）；
   * - wechat  : 微信小程序订阅消息，未实现；
   * - wecom   : 企业微信应用消息，未实现。
   */
  private async deferUnsupportedChannel(job: any, content: string, channel: string) {
    const receivers = Array.isArray(job.receivers_json) ? job.receivers_json : [];

    // sms 的网关已实现但需要配置；其余渠道代码尚未实现。
    // 二者都不允许记为 success，仅 error_msg 归因不同，便于运维定位。
    let reason: string;
    if (channel === 'sms') {
      const smsReady = await this.isSmsChannelReady();
      reason = smsReady ? 'channel_dispatch_not_wired' : 'channel_not_configured';
    } else if (channel === 'wechat' || channel === 'wecom' || channel === 'app') {
      reason = 'channel_not_implemented';
    } else {
      reason = 'channel_not_supported';
    }

    if (receivers.length > 0) {
      await this.prisma.notification_logs.createMany({
        data: receivers.map((receiver: any) => ({
          job_id: job.id,
          channel: channel,
          receiver: String(
            receiver?.name || receiver?.mobile || receiver?.openid || receiver?.student_id || '',
          ),
          content_snapshot: content,
          // 关键：不是 success
          send_status: 'deferred',
          provider: null,
          sent_at: new Date(),
          error_msg: reason,
          acknowledged: false,
        })),
      });
    }

    await this.prisma.notification_jobs.update({
      where: { id: job.id },
      data: {
        status: 'deferred',
        // 清空排期：避免被 processQueuedJobs 反复重扫
        schedule_at: null,
        // 非失败场景，不递增 try_count
        last_error: reason,
      },
    });

    this.logger.warn(
      `[通知派发] 渠道 ${channel} 未真实投递，任务=${job.id.toString()} 标记为 deferred（原因：${reason}），接收人 ${receivers.length} 个`,
    );
  }

  /** sms 渠道是否已在系统配置中填写网关（与 config.controller.ts 的测试短信一致用 system_settings） */
  private async isSmsChannelReady(): Promise<boolean> {
    try {
      const smsConfig = await this.systemConfigService.getSectionConfig('sms', {}, ['notification']);
      const normalized = normalizeSmsConfig(smsConfig);
      return isSmsConfigReady(normalized);
    } catch {
      return false;
    }
  }
}
