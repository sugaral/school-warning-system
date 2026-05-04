import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';

const SESSION_SETTLED_KEY_PREFIX = 'warning:session:settled';

export function buildSessionSettledKey(sessionId: bigint | string): string {
  return `${SESSION_SETTLED_KEY_PREFIX}:${sessionId.toString()}`;
}

export function buildSessionSettledPayload(): string {
  return JSON.stringify({
    version: 2,
    status: 'settled',
    settled_at: new Date().toISOString(),
  });
}

export function isTrustedSessionSettledValue(value: string | null): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed?.version === 2 && parsed?.status === 'settled';
  } catch {
    return false;
  }
}

export async function markSessionSettled(
  redis: RedisService,
  sessionId: bigint | string,
  ttlSeconds = 24 * 60 * 60,
  logger?: { warn: (msg: string) => void },
): Promise<void> {
  try {
    await redis.set(
      buildSessionSettledKey(sessionId),
      buildSessionSettledPayload(),
      'EX',
      ttlSeconds,
    );
  } catch (error) {
    logger?.warn(
      `标记课次结算失败 课次=${sessionId.toString()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function computeRecordDate(sessionStart: Date): Date {
  return new Date(
    Date.UTC(
      sessionStart.getFullYear(),
      sessionStart.getMonth(),
      sessionStart.getDate(),
    ),
  );
}

export async function findExistingRecordStudentIds(
  prisma: PrismaService,
  sessionId: bigint,
  studentIds: bigint[],
): Promise<Set<string>> {
  if (studentIds.length === 0) {
    return new Set();
  }

  const records = await prisma.attendance_records.findMany({
    where: {
      session_id: sessionId,
      student_id: { in: studentIds },
    },
    select: { student_id: true },
  });

  return new Set(records.map((r: any) => r.student_id.toString()));
}

export async function getApprovedLeaveStudentIds(
  prisma: PrismaService,
  studentIds: bigint[],
  sessionStart: Date,
  sessionEnd: Date,
): Promise<Set<string>> {
  if (studentIds.length === 0) {
    return new Set();
  }

  const leaveRequests = await prisma.leave_requests.findMany({
    where: {
      student_id: { in: studentIds },
      status: 'approved',
      from_date: { lte: sessionEnd },
      to_date: { gte: sessionStart },
    },
    select: { student_id: true },
  });

  return new Set(
    leaveRequests
      .map((item: any) => item.student_id?.toString?.() || '')
      .filter(Boolean),
  );
}
