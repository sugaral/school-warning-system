export type WarningRecalcTarget = {
  studentId: bigint;
  recordDate: Date;
  courseId?: bigint;
  sessionId?: bigint;
};

export type MergedWarningRecalcTarget = {
  studentId: bigint;
  recordDate: Date;
  courseIds: bigint[];
};

export type WarningQueueItem = {
  studentId: string;
  recordDate: string;
  courseId?: string;
  sessionId?: string;
};

export type WarningQueuePayload = {
  version: number;
  source: string;
  enqueuedAt: string;
  items: WarningQueueItem[];
};
