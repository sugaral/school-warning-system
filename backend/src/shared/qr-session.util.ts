import { createHash } from 'crypto';

export type RollingQrState = {
  bucketIndex: number;
  currentToken: string;
  nextRefreshAt: Date;
  remainingSeconds: number;
  refreshSeconds: number;
};

export function buildRollingScanToken(seed: string, bucketIndex: number) {
  return createHash('sha256')
    .update(`${seed}:${bucketIndex}`)
    .digest('hex')
    .slice(0, 16);
}

export function getQrBucketIndex(
  sessionStart: Date,
  refreshSeconds: number,
  now = new Date(),
) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - sessionStart.getTime()) / 1000),
  );
  return Math.floor(elapsedSeconds / Math.max(1, refreshSeconds));
}

export function getRollingQrState(input: {
  sessionStart: Date;
  sessionEnd?: Date | null;
  qrTokenHash: string;
  refreshSeconds: number;
  now?: Date;
}) {
  const now = input.now || new Date();
  const refreshSeconds = Math.max(1, Math.round(Number(input.refreshSeconds) || 1));
  const bucketIndex = getQrBucketIndex(input.sessionStart, refreshSeconds, now);
  const refreshMs = refreshSeconds * 1000;
  const nextRefreshMs =
    input.sessionStart.getTime() + (bucketIndex + 1) * refreshMs;
  const sessionDeadlineMs = input.sessionEnd?.getTime() || nextRefreshMs;
  const boundedNextRefreshMs = Math.min(nextRefreshMs, sessionDeadlineMs);
  const nextRefreshAt = new Date(boundedNextRefreshMs);
  const remainingSeconds = Math.max(
    0,
    Math.ceil((boundedNextRefreshMs - now.getTime()) / 1000),
  );

  return {
    bucketIndex,
    currentToken: buildRollingScanToken(input.qrTokenHash, bucketIndex),
    nextRefreshAt,
    remainingSeconds,
    refreshSeconds,
  } satisfies RollingQrState;
}

export function isRollingScanTokenValid(input: {
  providedToken: string;
  qrTokenHash: string;
  sessionStart: Date;
  refreshSeconds: number;
  now?: Date;
  leewayBuckets?: number;
}) {
  const now = input.now || new Date();
  const currentBucket = getQrBucketIndex(input.sessionStart, input.refreshSeconds, now);
  const leeway = Math.max(0, Math.floor(Number(input.leewayBuckets) || 0));
  const providedToken = String(input.providedToken || '').trim();

  for (let offset = 0; offset <= leeway; offset += 1) {
    const bucketIndex = Math.max(0, currentBucket - offset);
    if (buildRollingScanToken(input.qrTokenHash, bucketIndex) === providedToken) {
      return true;
    }
  }

  return false;
}
