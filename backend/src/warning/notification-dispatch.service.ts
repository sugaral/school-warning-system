import { Prisma } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { ConfigService as SystemConfigService } from '../config/config.service';
import { isEmailConfigReady, normalizeEmailConfig, sendEmail } from '../shared/email.util';
import { renderTemplate } from '../shared/template.util';

const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];

type WarningEmailQuotaRow = {
  sent_count: bigint | number | string | null;
  oldest_sent_at: Date | string | null;
};

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private readonly lockKey = 'lock:notification-dispatch';
  private readonly lockTtlMs = 20_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  @Cron('*/5 * * * * *', { timeZone: 'Asia/Shanghai' })
  async processQueuedJobs() {
    const lockResult = await this.redis.withLock(this.lockKey, this.lockTtlMs, async () => {
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
    });

    if (!lockResult.locked) {
      return;
    }
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  private isWarningEmailJob(job: any) {
    return (
      String(job?.channel || '').trim().toLowerCase() === 'email' &&
      (job?.warning_id !== null && job?.warning_id !== undefined
        || ['rule', 'config'].includes(String(job?.trigger_type || '').trim().toLowerCase()))
    );
  }

  private getCourseKey(courseId?: bigint | number | string | null) {
    return courseId ? String(courseId) : '__none__';
  }

  private async getWarningEmailThrottleDecision() {
    const rawWarningConfig = await this.systemConfigService.getConfig('warning', {});
    const maxPerHour = this.clampNumber(rawWarningConfig?.maxWarningEmailsPerHour, 60, 1, 5000);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<WarningEmailQuotaRow[]>(Prisma.sql`
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
        maxPerHour,
        sentCount,
        nextScheduleAt: null as Date | null,
      };
    }

    const nextScheduleAt = oldestSentAt && !Number.isNaN(oldestSentAt.getTime())
      ? new Date(oldestSentAt.getTime() + 60 * 60 * 1000 + 5_000)
      : new Date(Date.now() + 5 * 60 * 1000);

    return {
      limited: true,
      maxPerHour,
      sentCount,
      nextScheduleAt,
    };
  }

  private async isWarningJobStillActive(job: any) {
    if (!job?.warning_id) {
      return true;
    }

    const historyWarning = await this.prisma.warnings.findUnique({
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

    const currentState = await (this.prisma as any).warning_current_states.findFirst({
      where: {
        student_id: historyWarning.student_id,
        metric: historyWarning.metric,
        level: historyWarning.level,
        window: historyWarning.window,
        period_start: historyWarning.period_start,
        period_end: historyWarning.period_end,
        course_key: this.getCourseKey(historyWarning.course_id || null),
        status: { in: ACTIVE_WARNING_STATUSES },
      },
      select: { id: true },
    });

    return Boolean(currentState);
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

      if (this.isWarningEmailJob(job) && !(await this.isWarningJobStillActive(job))) {
        await this.prisma.notification_jobs.update({
          where: { id: job.id },
          data: {
            status: 'cancelled',
            last_error: 'warning_state_not_active',
          },
        });
        return;
      }

      const template = job.template_code
        ? await this.prisma.message_templates.findFirst({
            where: {
              template_code: job.template_code,
              channel: job.channel,
              status: 'active',
            },
          })
        : null;

      const params = (job.params_json as Record<string, any>) || {};
      const subject = template?.title ? renderTemplate(template.title, params) : '系统通知';
      const content = template?.content ? renderTemplate(template.content, params) : JSON.stringify(params || {});

      if (String(job.channel || '').toLowerCase() === 'email') {
        await this.sendEmailJob(job, subject, content);
      } else {
        await this.completeUnsupportedChannel(job, content);
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

    if (this.isWarningEmailJob(job)) {
      const throttleDecision = await this.getWarningEmailThrottleDecision();
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

    for (const email of emailTargets) {
      await this.prisma.notification_logs.create({
        data: {
          job_id: job.id,
          channel: 'email',
          receiver: email,
          content_snapshot: content,
          send_status: 'success',
          provider: emailConfig.provider || 'smtp',
          provider_msg_id: result.messageId || null,
          sent_at: new Date(),
          acknowledged: false,
        },
      });
    }

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

  private async completeUnsupportedChannel(job: any, content: string) {
    const receivers = Array.isArray(job.receivers_json) ? job.receivers_json : [];
    await this.prisma.notification_logs.createMany({
      data: receivers.map((receiver: any) => ({
        job_id: job.id,
        channel: String(job.channel || ''),
        receiver:
          String(receiver?.name || receiver?.mobile || receiver?.openid || receiver?.student_id || ''),
        content_snapshot: content,
        send_status: 'success',
        provider: 'deferred',
        sent_at: new Date(),
        acknowledged: false,
      })),
    });

    await this.prisma.notification_jobs.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        try_count: { increment: 1 },
        last_error: null,
      },
    });
  }
}
