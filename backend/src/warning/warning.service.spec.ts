import { WarningService } from './warning.service';

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);

describe('WarningService window boundaries', () => {
  const createService = (teachingConfig?: Record<string, unknown>) =>
    new WarningService(
      {} as any,
      {
        withLock: jest.fn(async (_key: string, _ttlMs: number, fn: () => Promise<any>) => ({
          locked: true,
          result: await fn(),
        })),
      } as any,
      {} as any,
      {
        getConfig: jest.fn().mockResolvedValue(teachingConfig || {}),
        getNumberConfig: jest.fn().mockResolvedValue(4),
      } as any,
      {
        refreshStudents: jest.fn().mockResolvedValue(undefined),
      } as any,
      {
        markStudentProcessing: jest.fn().mockResolvedValue(undefined),
        markStudentFailed: jest.fn().mockResolvedValue(undefined),
        clearStudentProcessing: jest.fn().mockResolvedValue(undefined),
      } as any,
    );

  it('calculates week window across year boundary by Monday to Sunday', async () => {
    const service = createService();
    const result = await (service as any).getWindowBoundaries(
      new Date('2026-12-30T12:00:00+08:00'),
      'week',
    );

    expect(formatDate(result.start)).toBe('2026-12-28');
    expect(formatDate(result.end)).toBe('2027-01-03');
  });

  it('uses configured semester start and total weeks for term window', async () => {
    const service = createService({
      semesterStartDate: '2026-02-16',
      semesterTotalWeeks: 20,
    });

    const result = await (service as any).getWindowBoundaries(
      new Date('2026-04-08T12:00:00+08:00'),
      'term',
    );

    expect(formatDate(result.start)).toBe('2026-02-16');
    expect(formatDate(result.end)).toBe('2026-07-05');
  });

  it('merges same-student same-day recalculations before batch processing', async () => {
    const service = createService();
    const recalcSpy = jest
      .spyOn(service, 'generateWarningForStudent')
      .mockResolvedValue({ warnings_generated: 1 } as any);

    const firstRecordDate = new Date('2026-04-20T08:00:00.000Z');
    const laterSameDayRecordDate = new Date('2026-04-20T10:00:00.000Z');

    const result = await service.generateWarningsForAffectedRecords([
      { studentId: 1n, recordDate: firstRecordDate, courseId: 101n },
      { studentId: 1n, recordDate: laterSameDayRecordDate, courseId: 102n },
      { studentId: 2n, recordDate: firstRecordDate, courseId: 201n },
    ]);

    expect(recalcSpy).toHaveBeenCalledTimes(2);
    expect(recalcSpy).toHaveBeenCalledWith(
      1n,
      laterSameDayRecordDate,
      undefined,
      { skipSnapshotRefresh: true },
    );
    expect(recalcSpy).toHaveBeenCalledWith(
      2n,
      firstRecordDate,
      201n,
      { skipSnapshotRefresh: true },
    );
    expect(result).toEqual({
      warnings_generated: 2,
      targets_processed: 2,
      targets_merged: 1,
      targets_locked: 0,
    });
  });

  it('uses course-specific wording for day warnings whenever course name is available', () => {
    const service = createService();

    const summary = (service as any).buildTriggerSummary(
      {
        id: 1n,
        class_id: 1n,
        org_id: 1n,
        users: {
          name: '张三',
          email: null,
        },
      },
      'absent',
      'day',
      2,
      '经济学3',
    );

    expect(summary).toBe('张三在《经济学3》课程中缺勤，触发日预警');
  });

  it('includes academic week label in week warning summaries', async () => {
    const service = createService({
      semesterStartDate: '2026-02-16',
      semesterTotalWeeks: 20,
    });

    const windowContext = await (service as any).resolveWarningWindowContext(
      'week',
      new Date('2026-04-06T00:00:00+08:00'),
    );
    const summary = (service as any).buildTriggerSummary(
      {
        id: 1n,
        class_id: 1n,
        org_id: 1n,
        users: {
          name: '张三',
          email: null,
        },
      },
      'absent',
      'week',
      2,
      '',
      windowContext,
    );

    expect(windowContext).toEqual({
      weekNumber: 8,
      weekLabel: '第8周',
    });
    expect(summary).toBe('张三在第8周缺勤课次达到2次，触发周预警');
  });

  it('uses cumulative warning wording for warning_total metric', () => {
    const service = createService();

    const summary = (service as any).buildTriggerSummary(
      {
        id: 1n,
        class_id: 1n,
        org_id: 1n,
        users: {
          name: '张三',
          email: null,
        },
      },
      'warning_total',
      'month',
      12,
    );

    expect(summary).toBe('张三本月累计预警达到12次，触发月预警');
  });
});
