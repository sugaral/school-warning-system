import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { ConfigService as SystemConfigService } from '../config/config.service';
import { isEmailConfigReady, normalizeEmailConfig, sendEmail } from '../shared/email.util';
import { renderTemplate } from '../shared/template.util';
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
  ) {}

  @Cron('*/5 * * * * *', { timeZone: 'Asia/Shanghai' })
  async processQueuedJobs() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
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
    }
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
