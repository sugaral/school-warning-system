import { Prisma, PrismaClient } from '@prisma/client';

export const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];

export type WarningEmailQuotaRow = {
  sent_count: bigint | number | string | null;
  oldest_sent_at: Date | string | null;
};

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function isWarningEmailJob(job: any): boolean {
  return (
    String(job?.channel || '').trim().toLowerCase() === 'email' &&
    (job?.warning_id !== null && job?.warning_id !== undefined
      || ['rule', 'config'].includes(String(job?.trigger_type || '').trim().toLowerCase()))
  );
}

export function getCourseKey(courseId?: bigint | number | string | null): string {
  return courseId ? String(courseId) : '__none__';
}

export async function isWarningJobStillActive(
  prisma: PrismaClient | any,
  job: any,
): Promise<boolean> {
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

  const currentState = await prisma.warning_current_states.findFirst({
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

export async function getWarningEmailThrottleDecision(
  prisma: PrismaClient | any,
  maxPerHour: number,
): Promise<{
  limited: boolean;
  maxPerHour: number;
  sentCount: number;
  nextScheduleAt: Date | null;
}> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await (prisma as PrismaClient).$queryRaw<WarningEmailQuotaRow[]>(Prisma.sql`
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
