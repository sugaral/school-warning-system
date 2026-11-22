import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma.service';
import { WarningCasesService } from '../warning-cases/warning-cases.service';
import { WarningProcessingService } from './warning-processing.service';
import { WarningSnapshotService } from './warning-snapshot.service';
import { WarningRecalcTarget } from './warning.types';

const DEFAULT_METRICS = ['late', 'absent', 'early_leave'] as const;
const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];

type StudentContext = {
  id: bigint;
  class_id: bigint;
  org_id: bigint | null;
  users?: {
    name: string | null;
  } | null;
};

@Injectable()
export class SessionWarningGenerationService {
  private readonly logger = new Logger(SessionWarningGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningSnapshotService: WarningSnapshotService,
    private readonly warningCasesService: WarningCasesService,
    private readonly warningProcessingService: WarningProcessingService,
  ) {}

  async startForEndedSession(
    sessionId: bigint,
    targets: WarningRecalcTarget[],
    processingText = '正在生成预警',
  ) {
    const normalizedTargets = Array.from(
      new Map(
        (Array.isArray(targets) ? targets : [])
          .filter((item) => item?.studentId && item?.recordDate instanceof Date)
          .map((item) => [
            [
              item.studentId.toString(),
              item.recordDate.toISOString().slice(0, 10),
              item.courseId?.toString?.() || '',
              item.sessionId?.toString?.() || '',
            ].join('_'),
            item,
          ]),
      ).values(),
    );

    if (normalizedTargets.length === 0) {
      return { accepted: 0 };
    }

    const studentIds = Array.from(
      new Map(
        normalizedTargets.map((target) => [target.studentId.toString(), target.studentId]),
      ).values(),
    );

    await Promise.all(
      studentIds.map((studentId) =>
        this.warningProcessingService.markStudentProcessing(studentId, processingText),
      ),
    );

    void this.generateDayWarningsForSessionBatch(sessionId, normalizedTargets)
      .then(async () => {
        await Promise.all(
          studentIds.map((studentId) =>
            this.warningProcessingService.clearStudentProcessing(studentId),
          ),
        );
      })
      .catch(async (error: any) => {
        await Promise.all(
          studentIds.map((studentId) =>
            this.warningProcessingService.markStudentFailed(
              studentId,
              '预警生成失败',
            ),
          ),
        );
        this.logger.error(
          `[课次预警] 课次 ${sessionId.toString()} 批量生成失败`,
          error?.stack || error?.message || String(error),
        );
      });

    return {
      accepted: normalizedTargets.length,
    };
  }

  private async generateDayWarningsForSessionBatch(
    sessionId: bigint,
    targets: WarningRecalcTarget[],
  ) {
    const startedAt = Date.now();
    const studentIds = Array.from(
      new Map(targets.map((target) => [target.studentId.toString(), target.studentId])).values(),
    );
    const sampleTarget = targets[0];
    const periodDate = new Date(sampleTarget.recordDate);
    const periodStart = new Date(
      Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), periodDate.getUTCDate()),
    );
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCHours(23, 59, 59, 999);

    const session = await this.prisma.class_sessions.findUnique({
      where: { id: sessionId },
      include: {
        courses: {
          select: {
            course_name: true,
          },
        },
      },
    });

    if (!session) {
      throw new Error(`session ${sessionId.toString()} not found`);
    }

    const [students, rules, records, currentStates] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          class_id: true,
          org_id: true,
          users: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.warning_rules.findMany({
        where: {
          enabled: true,
          window: 'day',
          metric: { in: [...DEFAULT_METRICS] },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.attendance_records.findMany({
        where: {
          student_id: { in: studentIds },
          attendance_status: { in: [...DEFAULT_METRICS] },
          sessions: {
            course_id: session.course_id,
            session_start: {
              gte: periodStart,
              lte: new Date(periodStart.getTime() + 24 * 60 * 60 * 1000 - 1),
            },
          },
        },
        select: {
          student_id: true,
          attendance_status: true,
          checkin_time: true,
          created_at: true,
        },
      }),
      (this.prisma as any).warning_current_states.findMany({
        where: {
          student_id: { in: studentIds },
          course_id: session.course_id,
          window: 'day',
          period_start: periodStart,
          period_end: periodEnd,
          metric: { in: [...DEFAULT_METRICS] },
          status: { in: ACTIVE_WARNING_STATUSES },
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const studentMap = new Map(
      students.map((student: any) => [student.id.toString(), student as StudentContext]),
    );
    const recordCountMap = new Map<string, Record<string, number>>();
    records.forEach((record: any) => {
      const key = record.student_id.toString();
      const current = recordCountMap.get(key) || { late: 0, absent: 0, early_leave: 0 };
      const status = String(record.attendance_status || '').trim();
      if (status in current) {
        current[status] += 1;
      }
      recordCountMap.set(key, current);
    });
    const currentStateMap = new Map<string, any[]>();
    currentStates.forEach((state: any) => {
      const key = state.student_id.toString();
      const list = currentStateMap.get(key) || [];
      list.push(state);
      currentStateMap.set(key, list);
    });

    const closedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const studentId of studentIds) {
        const student = studentMap.get(studentId.toString());
        if (!student) {
          continue;
        }

        const metricCounts = recordCountMap.get(studentId.toString()) || {
          late: 0,
          absent: 0,
          early_leave: 0,
        };

        const matchedRules = DEFAULT_METRICS
          .map((metric) => {
            const count = Number(metricCounts[metric] || 0);
            if (count <= 0) {
              return null;
            }
            const effectiveRules = this.resolveEffectiveRulesForStudent(rules, student, metric);
            const matchedRule = effectiveRules.find((rule: any) => count >= Number(rule.threshold || 0)) || null;
            if (!matchedRule) {
              return null;
            }
            return { metric, count, rule: matchedRule };
          })
          .filter(Boolean) as Array<{ metric: string; count: number; rule: any }>;

        const existingStates = currentStateMap.get(studentId.toString()) || [];
        if (matchedRules.length === 0) {
          await this.closeCurrentStates(tx, existingStates, '系统重算后该课程在当前时间窗内已不再满足预警条件', closedAt);
          continue;
        }

        const primary = this.pickPrimaryRule(matchedRules);
        const totalCount = Object.values(metricCounts).reduce((sum, value) => sum + Number(value || 0), 0);
        const metricTextMap: Record<string, string> = {
          late: '迟到',
          absent: '缺勤',
          early_leave: '早退',
        };
        const studentName = student.users?.name || '未知学生';
        const courseName = session.courses?.course_name || '';
        const metricText = metricTextMap[primary.metric] || primary.metric;
        const triggerSummary = courseName
          ? `${studentName}在《${courseName}》课程中今日${metricText} ${primary.count} 次，触发日预警`
          : `${studentName}今日${metricText} ${primary.count} 次，触发日预警`;
        const triggerDetail = {
          violation_count: totalCount,
          total_count: totalCount,
          dominant_metric: primary.metric,
          late_count: Number(metricCounts.late || 0),
          absent_count: Number(metricCounts.absent || 0),
          early_leave_count: Number(metricCounts.early_leave || 0),
          course_id: session.course_id.toString(),
          course_name: session.courses?.course_name || '',
          session_id: session.id.toString(),
          session_start: session.session_start,
          triggered_at: session.session_end || session.qr_expire_at || new Date(),
        };

        const canonical = existingStates[0] || null;
        const staleStates = existingStates.filter((state: any) => !canonical || state.id !== canonical.id);
        await this.closeCurrentStates(tx, staleStates, '系统重算后已收敛为课程聚合预警', closedAt);

        if (canonical) {
          const updated = await (tx as any).warning_current_states.update({
            where: { id: canonical.id },
            data: {
              class_id: student.class_id,
              org_id: student.org_id || 0n,
              metric: primary.metric,
              level: primary.rule.level,
              course_id: session.course_id,
              course_key: session.course_id.toString(),
              rule_id: primary.rule.id,
              rule_snapshot_json: this.serializeRuleSnapshot(primary.rule, 'day'),
              trigger_summary: triggerSummary,
              trigger_detail_json: triggerDetail,
              current_count: totalCount,
              updated_at: new Date(),
            },
          });
          await this.appendHistory(tx, {
            student_id: updated.student_id,
            class_id: updated.class_id,
            org_id: updated.org_id,
            metric: updated.metric,
            level: updated.level,
            window: updated.window,
            period_start: updated.period_start,
            period_end: updated.period_end,
            rule_id: updated.rule_id,
            rule_snapshot_json: updated.rule_snapshot_json,
            trigger_summary: updated.trigger_summary,
            trigger_detail_json: updated.trigger_detail_json,
            course_id: updated.course_id || null,
            status: updated.status,
            acknowledged_at: updated.acknowledged_at || null,
            acknowledged_by: updated.acknowledged_by || null,
          });
          continue;
        }

        const current = await this.upsertCurrentWarningState(tx, {
          student_id: student.id,
          class_id: student.class_id,
          org_id: student.org_id || 0n,
          metric: primary.metric,
          level: primary.rule.level,
          window: 'day',
          period_start: periodStart,
          period_end: periodEnd,
          course_key: session.course_id.toString(),
          course_id: session.course_id,
          rule_id: primary.rule.id,
          rule_snapshot_json: this.serializeRuleSnapshot(primary.rule, 'day'),
          trigger_summary: triggerSummary,
          trigger_detail_json: triggerDetail,
          status: 'open',
          current_count: totalCount,
        });

        await this.appendHistory(tx, {
          student_id: current.student_id,
          class_id: current.class_id,
          org_id: current.org_id,
          metric: current.metric,
          level: current.level,
          window: current.window,
          period_start: current.period_start,
          period_end: current.period_end,
          rule_id: current.rule_id,
          rule_snapshot_json: current.rule_snapshot_json,
          trigger_summary: current.trigger_summary,
          trigger_detail_json: current.trigger_detail_json,
          course_id: current.course_id || null,
          status: current.status,
        });
      }
    });

    await this.warningSnapshotService.refreshStudents(studentIds);
    await Promise.all(
      studentIds.map((studentId) =>
        this.warningProcessingService.markStudentProcessing(
          studentId,
          '正在完善预警相关信息',
        ),
      ),
    );
    await this.warningCasesService.syncStudentsByIds(studentIds);
    await Promise.all(
      studentIds.map((studentId) =>
        this.warningProcessingService.clearStudentProcessing(studentId),
      ),
    );

    this.logger.log(
      `[课次预警] 课次=${sessionId.toString()} 批量日预警完成 学生=${studentIds.length} 耗时=${Date.now() - startedAt}ms`,
    );
  }

  private resolveEffectiveRulesForStudent(rules: any[], student: StudentContext, metric: string) {
    const selectedRules = new Map<string, any>();
    for (const rule of rules) {
      if (String(rule.metric || '').trim() !== metric) {
        continue;
      }
      if (!this.ruleMatchesStudent(rule, student)) {
        continue;
      }
      const key = `${rule.metric}:${rule.window}:${rule.level}`;
      const current = selectedRules.get(key);
      if (!current || this.compareRulePriority(rule, current) > 0) {
        selectedRules.set(key, rule);
      }
    }
    return Array.from(selectedRules.values()).sort((left, right) => Number(right.threshold || 0) - Number(left.threshold || 0));
  }

  private ruleMatchesStudent(rule: any, student: StudentContext) {
    const scope = this.normalizeScope(rule.scope);
    if (scope === 'school') {
      return true;
    }
    if (scope === 'org') {
      return Boolean(student.org_id && rule.scope_id && student.org_id.toString() === rule.scope_id.toString());
    }
    if (scope === 'class') {
      return Boolean(student.class_id && rule.scope_id && student.class_id.toString() === rule.scope_id.toString());
    }
    return false;
  }

  private normalizeScope(scope?: string) {
    if (scope === 'college') {
      return 'org';
    }
    if (scope === 'org' || scope === 'class' || scope === 'school') {
      return scope;
    }
    return 'school';
  }

  private compareRulePriority(left: any, right: any) {
    const scopeWeight = (rule: any) => {
      const scope = this.normalizeScope(rule.scope);
      if (scope === 'class') return 3;
      if (scope === 'org') return 2;
      return 1;
    };

    const scopeDiff = scopeWeight(left) - scopeWeight(right);
    if (scopeDiff !== 0) {
      return scopeDiff;
    }

    const leftTime = new Date(left.created_at || 0).getTime();
    const rightTime = new Date(right.created_at || 0).getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left.id || '').localeCompare(String(right.id || ''));
  }

  private pickPrimaryRule(
    matchedRules: Array<{ metric: string; count: number; rule: any }>,
  ) {
    const levelWeight: Record<string, number> = {
      yellow: 1,
      orange: 2,
      red: 3,
      severe: 4,
    };
    const metricWeight: Record<string, number> = {
      absent: 3,
      early_leave: 2,
      late: 1,
    };

    return [...matchedRules].sort((left, right) => {
      const levelDiff =
        (levelWeight[String(right.rule?.level || '')] || 0) -
        (levelWeight[String(left.rule?.level || '')] || 0);
      if (levelDiff !== 0) {
        return levelDiff;
      }
      const metricDiff =
        (metricWeight[String(right.metric || '')] || 0) -
        (metricWeight[String(left.metric || '')] || 0);
      if (metricDiff !== 0) {
        return metricDiff;
      }
      return Number(right.count || 0) - Number(left.count || 0);
    })[0];
  }

  private buildShortSummary(metricCounts: Record<string, number>) {
    return [
      `迟到${Number(metricCounts.late || 0)}次`,
      `缺勤${Number(metricCounts.absent || 0)}次`,
      `早退${Number(metricCounts.early_leave || 0)}次`,
    ].join('，');
  }

  private serializeRuleSnapshot(rule: any, windowType: string) {
    return {
      id: rule.id?.toString?.() || String(rule.id || ''),
      metric: rule.metric,
      level: rule.level,
      threshold: rule.threshold,
      scope: rule.scope,
      scope_id: rule.scope_id?.toString?.() || null,
      notify_strategy_json: rule.notify_strategy_json || null,
      window: windowType,
      created_at: rule.created_at || null,
      updated_at: rule.updated_at || null,
    };
  }

  private async upsertCurrentWarningState(
    tx: any,
    payload: {
      student_id: bigint;
      class_id: bigint;
      org_id: bigint;
      metric: string;
      level: string;
      window: string;
      period_start: Date;
      period_end: Date;
      course_key: string;
      course_id: bigint;
      rule_id: bigint;
      rule_snapshot_json: any;
      trigger_summary: string;
      trigger_detail_json: any;
      status: string;
      current_count: number;
    },
  ) {
    try {
      return await (tx as any).warning_current_states.create({
        data: payload,
      });
    } catch (error: any) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const existing = await (tx as any).warning_current_states.findFirst({
        where: {
          student_id: payload.student_id,
          metric: payload.metric,
          window: payload.window,
          period_start: payload.period_start,
          period_end: payload.period_end,
          course_key: payload.course_key,
        },
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      });

      if (!existing) {
        throw error;
      }

      return await (tx as any).warning_current_states.update({
        where: { id: existing.id },
        data: {
          class_id: payload.class_id,
          org_id: payload.org_id,
          metric: payload.metric,
          level: payload.level,
          course_id: payload.course_id,
          course_key: payload.course_key,
          rule_id: payload.rule_id,
          rule_snapshot_json: payload.rule_snapshot_json,
          trigger_summary: payload.trigger_summary,
          trigger_detail_json: payload.trigger_detail_json,
          status: payload.status,
          current_count: payload.current_count,
          updated_at: new Date(),
        },
      });
    }
  }

  private async appendHistory(tx: any, payload: any) {
    return tx.warnings.create({
      data: {
        student_id: payload.student_id,
        class_id: payload.class_id,
        org_id: payload.org_id,
        metric: payload.metric,
        level: payload.level,
        window: payload.window,
        period_start: payload.period_start,
        period_end: payload.period_end,
        rule_id: payload.rule_id,
        rule_snapshot_json: payload.rule_snapshot_json,
        trigger_summary: payload.trigger_summary,
        trigger_detail_json: payload.trigger_detail_json || null,
        course_id: payload.course_id || null,
        status: payload.status,
        acknowledged_at: payload.acknowledged_at || null,
        acknowledged_by: payload.acknowledged_by || null,
        closed_at: payload.closed_at || null,
        closed_by: payload.closed_by || null,
        close_note: payload.close_note || null,
      },
    });
  }


  private async closeCurrentStates(tx: any, states: any[], closeNote: string, closedAt: Date) {
    if (!Array.isArray(states) || states.length === 0) {
      return;
    }

    for (const state of states) {
      await this.appendHistory(tx, {
        student_id: state.student_id,
        class_id: state.class_id,
        org_id: state.org_id,
        metric: state.metric,
        level: state.level,
        window: state.window,
        period_start: state.period_start,
        period_end: state.period_end,
        rule_id: state.rule_id,
        rule_snapshot_json: state.rule_snapshot_json,
        trigger_summary: state.trigger_summary,
        trigger_detail_json: state.trigger_detail_json,
        course_id: state.course_id || null,
        status: 'closed',
        acknowledged_at: state.acknowledged_at || null,
        acknowledged_by: state.acknowledged_by || null,
        closed_at: closedAt,
        close_note: closeNote,
      });
    }

    await (tx as any).warning_current_states.deleteMany({
      where: { id: { in: states.map((state: any) => state.id) } },
    });
  }
}
