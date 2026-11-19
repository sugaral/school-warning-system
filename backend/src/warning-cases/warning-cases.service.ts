import { Injectable } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';

const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];
const HIGH_RISK_THRESHOLD = 60;
const WARNING_LEVEL_SCORES: Record<string, number> = {
  yellow: 10,
  orange: 18,
  red: 28,
  severe: 40,
};
const STATUS_LABELS: Record<string, string> = {
  pending_assignment: '待分配',
  pending_intervention: '待干预',
  in_progress: '处理中',
  completed: '处理完成',
  resolved: '已解除',
};
const STATUS_TAG_TYPES: Record<string, string> = {
  pending_assignment: 'danger',
  pending_intervention: 'warning',
  in_progress: 'info',
  completed: 'success',
  resolved: 'info',
};

type StudentContext = {
  id: bigint;
  class_id: bigint;
  org_id: bigint | null;
  users?: { name: string | null } | null;
};

@Injectable()
export class WarningCasesService {
  constructor(private readonly prisma: PrismaService) {}

  async syncStudentsByIds(values: Array<bigint | string | number | null | undefined>) {
    const studentIds = this.normalizeBigIntValues(values);
    if (studentIds.length === 0) {
      return;
    }

    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        class_id: true,
        org_id: true,
      },
    });

    for (const student of students) {
      await this.syncStudentCase(this.prisma, student as StudentContext);
    }
  }

  async reconcileActiveCases(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    query: {
      keyword?: string;
      orgId?: string;
      classId?: string;
      handlerUserId?: string;
    } = {},
  ) {
    const where = await this.buildCaseWhere(access, {
      keyword: query.keyword,
      orgId: query.orgId,
      classId: query.classId,
      handlerUserId: query.handlerUserId,
      activeOnly: true,
    });

    const activeCases = await this.prisma.warning_cases.findMany({
      where,
      select: {
        student_id: true,
      },
    });

    await this.syncStudentsByIds(activeCases.map((item: any) => item.student_id));
  }

  async syncStudentCase(tx: any, student: StudentContext) {
    const activeWarnings = await tx.warning_current_states.findMany({
      where: {
        student_id: student.id,
        status: { in: ACTIVE_WARNING_STATUSES },
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    });

    const activeCase = await tx.warning_cases.findFirst({
      where: {
        student_id: student.id,
        is_active: true,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    const risk = await this.calculateRisk(tx, student.id, activeWarnings);
    const primaryWarning = this.pickPrimaryWarning(activeWarnings);
    const sourceWarningIds = activeWarnings.map((warning: any) => warning.id.toString());
    const latestWarningAt = activeWarnings[0]?.created_at || null;

    if (!this.shouldManageCase(activeWarnings, risk.score)) {
      if (activeCase) {
        await this.resolveCase(tx, activeCase.id, '系统重算后已退出高风险范围');
      }
      return null;
    }

    const classInfo = await tx.classes.findUnique({
      where: { id: student.class_id },
      select: {
        counselor_user_id: true,
      },
    });

    if (activeCase) {
      return this.updateActiveCase(tx, activeCase, {
        student,
        classInfo,
        risk,
        primaryWarningId: primaryWarning?.id || null,
        sourceWarningIds,
        latestWarningAt,
      });
    }

    const lastClosedCase = await tx.warning_cases.findFirst({
      where: {
        student_id: student.id,
        is_active: false,
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    });

    if (this.shouldDelayReopen(lastClosedCase, latestWarningAt, risk.score, sourceWarningIds)) {
      return lastClosedCase;
    }

    return this.createCase(tx, {
      student,
      classInfo,
      risk,
      primaryWarningId: primaryWarning?.id || null,
      sourceWarningIds,
      latestWarningAt,
    });
  }

  async listCases(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    query: {
      status?: string;
      keyword?: string;
      page?: number;
      pageSize?: number;
      includeInactive?: boolean;
      handlerUserId?: string;
      orgId?: string;
      classId?: string;
      activeOnly?: boolean;
    } = {},
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    const scopedOrgIds = access.orgScopeIds || [];
    const scopedClassIds = access.classScopeIds || [];

    if (query.activeOnly) {
      where.is_active = true;
    } else if (!query.includeInactive) {
      where.is_active = true;
    }

    if (query.status === 'resolved') {
      return this.emptyCaseResult(page, pageSize);
    }

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { not: 'resolved' };
    }

    if (query.handlerUserId) {
      where.handler_user_id = BigInt(query.handlerUserId);
    }

    if (query.classId) {
      const classId = BigInt(query.classId);
      if (scopedClassIds.length > 0 && !scopedClassIds.some((item: any) => item.toString() === classId.toString())) {
        return this.emptyCaseResult(page, pageSize);
      }
      where.class_id = classId;
    } else if (scopedClassIds.length > 0) {
      where.class_id = { in: this.uniqueBigInts(scopedClassIds) };
    }

    if (query.orgId) {
      const orgId = BigInt(query.orgId);
      if (scopedOrgIds.length > 0 && !scopedOrgIds.some((item: any) => item.toString() === orgId.toString())) {
        return this.emptyCaseResult(page, pageSize);
      }
      where.org_id = orgId;
    } else if (scopedOrgIds.length > 0) {
      where.org_id = { in: this.uniqueBigInts(scopedOrgIds) };
    }

    if (query.keyword) {
      const keyword = query.keyword.trim();
      const students = await this.prisma.student_profiles.findMany({
        where: {
          OR: [
            { student_no: { contains: keyword } },
            { users: { is: { name: { contains: keyword } } } },
          ],
        },
        select: {
          id: true,
        },
      });

      if (students.length === 0) {
        return this.emptyCaseResult(page, pageSize);
      }

      where.student_id = { in: students.map((item: any) => item.id) };
    }

    const skip = (page - 1) * pageSize;
    const [total, cases] = await Promise.all([
      this.prisma.warning_cases.count({ where }),
      this.prisma.warning_cases.findMany({
        where,
        orderBy: [{ risk_score: 'desc' }, { handling_priority: 'desc' }, { updated_at: 'desc' }],
        skip,
        take: pageSize,
      }),
    ]);

    const items = await this.buildCaseItems(cases);
    return {
      total,
      page,
      page_size: pageSize,
      items,
    };
  }

  async assignCase(caseId: bigint, actorUserId: bigint, handlerUserId?: bigint, note?: string) {
    let currentCase = await this.prisma.warning_cases.findUnique({
      where: { id: caseId },
    });

    if (!currentCase) {
      throw new Error('工单不存在');
    }

    let nextHandlerUserId = handlerUserId;
    if (!nextHandlerUserId) {
      const classInfo = await this.prisma.classes.findUnique({
        where: { id: currentCase.class_id },
        select: { counselor_user_id: true },
      });
      nextHandlerUserId = classInfo?.counselor_user_id || undefined;
    }

    if (!nextHandlerUserId) {
      throw new Error('当前班级未绑定班主任，无法自动分配');
    }

    const assignedAt = new Date();
    const updatedCase = await this.prisma.warning_cases.update({
      where: { id: caseId },
      data: {
        handler_user_id: nextHandlerUserId,
        assigned_by: actorUserId,
        assigned_at: assignedAt,
        status: 'pending_intervention',
        handling_priority: this.calculateHandlingPriority(
          currentCase.risk_score,
          'pending_intervention',
          assignedAt,
          currentCase.accepted_at,
        ),
      },
    });

    await this.createLog(this.prisma, caseId, 'assign', actorUserId, note || '已分配处理人', {
      handler_user_id: nextHandlerUserId.toString(),
    });

    return updatedCase;
  }

  async acceptCase(caseId: bigint, actorUserId: bigint, classScopeIds: bigint[] = [], note?: string) {
    let currentCase = await this.prisma.warning_cases.findUnique({
      where: { id: caseId },
    });

    if (!currentCase) {
      throw new Error('工单不存在');
    }

    if (
      classScopeIds.length > 0
      && !classScopeIds.some((item: any) => item.toString() === currentCase.class_id.toString())
    ) {
      throw new Error('只能由当前班级班主任确认接手');
    }

    const acceptedAt = new Date();
    const isTakingOver = !currentCase.handler_user_id || currentCase.handler_user_id.toString() !== actorUserId.toString();
    const updatedCase = await this.prisma.warning_cases.update({
      where: { id: caseId },
      data: {
        status: 'in_progress',
        handler_user_id: actorUserId,
        assigned_at: currentCase.assigned_at || acceptedAt,
        accepted_at: acceptedAt,
        handling_priority: this.calculateHandlingPriority(
          currentCase.risk_score,
          'in_progress',
          currentCase.assigned_at || acceptedAt,
          acceptedAt,
        ),
      },
    });

    await this.prisma.warnings.updateMany({
      where: {
        student_id: currentCase.student_id,
        status: 'open',
      },
      data: {
        status: 'acknowledged',
        acknowledged_at: acceptedAt,
        acknowledged_by: actorUserId,
      },
    });

    await this.createLog(
      this.prisma,
      caseId,
      'accept',
      actorUserId,
      note || (isTakingOver ? '班主任已接手并成为当前处理人' : '班主任已确认接手'),
      isTakingOver ? { previous_handler_user_id: currentCase.handler_user_id?.toString() || null } : undefined,
    );
    return updatedCase;
  }

  async completeCase(caseId: bigint, actorUserId: bigint, completionSummary: string, completionDetail?: string) {
    const currentCase = await this.prisma.warning_cases.findUnique({
      where: { id: caseId },
    });

    if (!currentCase) {
      throw new Error('工单不存在');
    }

    if (!currentCase.handler_user_id || currentCase.handler_user_id.toString() !== actorUserId.toString()) {
      throw new Error('只能由当前处理人提交处理结果');
    }

    const completedAt = new Date();
    const updatedCase = await this.prisma.warning_cases.update({
      where: { id: caseId },
      data: {
        status: 'completed',
        is_active: false,
        completed_at: completedAt,
        accepted_at: currentCase.accepted_at || completedAt,
        completion_summary: completionSummary,
        completion_detail_json: completionDetail ? { detail: completionDetail } : undefined,
        handling_priority: 0,
      },
    });

    await this.createLog(this.prisma, caseId, 'complete', actorUserId, completionSummary, {
      detail: completionDetail || '',
    });

    return updatedCase;
  }

  async deleteCases(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    caseIds: Array<bigint | string | number | null | undefined>,
  ) {
    const normalizedIds = this.normalizeBigIntValues(caseIds);
    if (normalizedIds.length === 0) {
      return {
        deleted_count: 0,
        blocked: [],
      };
    }

    const cases = await this.prisma.warning_cases.findMany({
      where: { id: { in: normalizedIds } },
      select: {
        id: true,
        status: true,
        is_active: true,
        class_id: true,
        org_id: true,
      },
    });

    const caseMap = new Map(cases.map((item: any) => [item.id.toString(), item]));
    const deletableIds: bigint[] = [];
    const blocked: Array<{ id: string; reason: string }> = [];

    for (const caseId of normalizedIds) {
      const caseItem = caseMap.get(caseId.toString());
      if (!caseItem) {
        blocked.push({
          id: caseId.toString(),
          reason: '记录不存在',
        });
        continue;
      }

      try {
        this.assertCaseAccessible(access, caseItem);
      } catch (error: any) {
        blocked.push({
          id: caseId.toString(),
          reason: error?.message || '无权删除该记录',
        });
        continue;
      }

      if (!this.isCaseDeletable(caseItem)) {
        blocked.push({
          id: caseId.toString(),
          reason: '仅支持删除已完成或已解除的高风险干预记录',
        });
        continue;
      }

      deletableIds.push(caseItem.id);
    }

    if (deletableIds.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.warning_case_logs.deleteMany({
          where: {
            case_id: { in: deletableIds },
          },
        });

        await tx.warning_cases.deleteMany({
          where: {
            id: { in: deletableIds },
          },
        });
      });
    }

    return {
      deleted_count: deletableIds.length,
      blocked,
    };
  }

  async getHighRiskStudents(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    limit = 10,
  ) {
    const result = await this.listCases(access, {
      page: 1,
      pageSize: limit,
      activeOnly: true,
    });

    return {
      total: result.total,
      items: result.items.map((item: any) => ({
        caseId: item.id,
        id: item.student_no,
        name: item.student_name,
        department: item.org_name,
        className: item.class_name,
        riskScore: item.risk_score,
        warningCount: item.active_warning_count,
        lastWarning: item.latest_warning_at ? this.formatDate(item.latest_warning_at) : '',
        status: STATUS_LABELS[item.status] || item.status,
        statusCode: item.status,
        statusType: STATUS_TAG_TYPES[item.status] || 'info',
        handlerName: item.handler_name || '未分配',
      })),
    };
  }

  async getCaseSummary(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    query: {
      status?: string;
      keyword?: string;
      includeInactive?: boolean;
      orgId?: string;
      classId?: string;
    } = {},
  ) {
    if (query.status === 'resolved') {
      return {
        total: 0,
        pendingAssignment: 0,
        pendingIntervention: 0,
        inProgress: 0,
        completed: 0,
        resolved: 0,
        avgRiskScore: 0,
        topRiskScore: 0,
      };
    }

    const where = await this.buildCaseWhere(access, query);
    where.status = query.status ? query.status : { not: 'resolved' };
    const cases = await this.prisma.warning_cases.findMany({
      where,
      select: {
        status: true,
        risk_score: true,
      },
    });

    const summary = {
      total: cases.length,
      pendingAssignment: 0,
      pendingIntervention: 0,
      inProgress: 0,
      completed: 0,
      resolved: 0,
      avgRiskScore: 0,
      topRiskScore: 0,
    };

    for (const item of cases) {
      const riskScore = Number(item.risk_score || 0);
      summary.topRiskScore = Math.max(summary.topRiskScore, riskScore);
      if (item.status === 'pending_assignment') summary.pendingAssignment += 1;
      if (item.status === 'pending_intervention') summary.pendingIntervention += 1;
      if (item.status === 'in_progress') summary.inProgress += 1;
      if (item.status === 'completed') summary.completed += 1;
      if (item.status === 'resolved') summary.resolved += 1;
      summary.avgRiskScore += riskScore;
    }

    if (cases.length > 0) {
      summary.avgRiskScore = Math.round(summary.avgRiskScore / cases.length);
    }

    return summary;
  }

  async getCaseDetail(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    caseId: bigint,
  ) {
    let currentCase = await this.prisma.warning_cases.findUnique({
      where: { id: caseId },
    });

    if (!currentCase) {
      throw new Error('工单不存在');
    }

    if (currentCase.is_active) {
      await this.syncStudentsByIds([currentCase.student_id]);
      currentCase = await this.prisma.warning_cases.findUnique({
        where: { id: caseId },
      });
      if (!currentCase) {
        throw new Error('Case not found');
      }
    }

    this.assertCaseAccessible(access, currentCase);

    const [items, logs] = await Promise.all([
      this.buildCaseItems([currentCase]),
      this.getCaseLogs(access, caseId),
    ]);

    return {
      ...(items[0] || null),
      logs,
    };
  }

  async getCaseLogs(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    caseId: bigint,
  ) {
    let currentCase = await this.prisma.warning_cases.findUnique({
      where: { id: caseId },
      select: { id: true, student_id: true, class_id: true, org_id: true, is_active: true },
    });

    if (!currentCase) {
      throw new Error('工单不存在');
    }

    if (currentCase.is_active) {
      await this.syncStudentsByIds([currentCase.student_id]);
      currentCase = await this.prisma.warning_cases.findUnique({
        where: { id: caseId },
        select: { id: true, student_id: true, class_id: true, org_id: true, is_active: true },
      });
      if (!currentCase) {
        throw new Error('Case not found');
      }
    }

    this.assertCaseAccessible(access, currentCase);

    const logs = await this.prisma.warning_case_logs.findMany({
      where: { case_id: caseId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    const actorIds = this.uniqueBigInts(logs.map((item: any) => item.actor_user_id));
    const actors = actorIds.length > 0
      ? await this.prisma.users.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const actorMap = new Map(actors.map((item: any) => [item.id.toString(), item.name]));

    return logs.map((item: any) => ({
      id: item.id.toString(),
      action: item.action,
      action_label: this.getActionLabel(item.action),
      actor_user_id: item.actor_user_id?.toString() || '',
      actor_name: item.actor_user_id ? actorMap.get(item.actor_user_id.toString()) || '未知用户' : '系统',
      note: item.note || '',
      detail_json: item.detail_json || null,
      created_at: item.created_at,
    }));
  }

  private async updateActiveCase(
    tx: any,
    currentCase: any,
    payload: {
      student: StudentContext;
      classInfo: { counselor_user_id?: bigint | null } | null;
      risk: any;
      primaryWarningId: bigint | null;
      sourceWarningIds: string[];
      latestWarningAt: Date | null;
    },
  ) {
    const updates: Record<string, any> = {
      class_id: payload.student.class_id,
      org_id: payload.student.org_id || 0n,
      primary_warning_id: payload.primaryWarningId,
      source_warning_ids_json: payload.sourceWarningIds,
      risk_score: payload.risk.score,
      risk_breakdown_json: payload.risk.breakdown,
      warning_summary_json: payload.risk.warningSummary,
      latest_warning_at: payload.latestWarningAt,
      last_risk_at: new Date(),
    };

    let nextStatus = currentCase.status;
    let handlerUserId = currentCase.handler_user_id;
    let assignedAt = currentCase.assigned_at;

    if (!handlerUserId && payload.classInfo?.counselor_user_id) {
      handlerUserId = payload.classInfo.counselor_user_id;
      assignedAt = assignedAt || new Date();
      nextStatus = 'pending_intervention';
      updates.handler_user_id = handlerUserId;
      updates.assigned_at = assignedAt;
      updates.status = nextStatus;

      await this.createLog(
        tx,
        currentCase.id,
        'auto_assign',
        null,
        '系统根据班级绑定自动分配给班主任',
        { handler_user_id: handlerUserId.toString() },
      );
    }

    updates.handling_priority = this.calculateHandlingPriority(
      payload.risk.score,
      nextStatus,
      assignedAt,
      currentCase.accepted_at,
    );

    return tx.warning_cases.update({
      where: { id: currentCase.id },
      data: updates,
    });
  }

  private async createCase(
    tx: any,
    payload: {
      student: StudentContext;
      classInfo: { counselor_user_id?: bigint | null } | null;
      risk: any;
      primaryWarningId: bigint | null;
      sourceWarningIds: string[];
      latestWarningAt: Date | null;
    },
  ) {
    const now = new Date();
    const handlerUserId = payload.classInfo?.counselor_user_id || null;
    const status = handlerUserId ? 'pending_intervention' : 'pending_assignment';

    const createdCase = await tx.warning_cases.create({
      data: {
        student_id: payload.student.id,
        class_id: payload.student.class_id,
        org_id: payload.student.org_id || 0n,
        primary_warning_id: payload.primaryWarningId,
        source_warning_ids_json: payload.sourceWarningIds,
        risk_score: payload.risk.score,
        risk_breakdown_json: payload.risk.breakdown,
        warning_summary_json: payload.risk.warningSummary,
        handling_priority: this.calculateHandlingPriority(
          payload.risk.score,
          status,
          handlerUserId ? now : null,
          null,
        ),
        status,
        handler_user_id: handlerUserId,
        assigned_at: handlerUserId ? now : null,
        latest_warning_at: payload.latestWarningAt,
        last_risk_at: now,
        is_active: true,
      },
    });

    await this.createLog(tx, createdCase.id, 'create', null, '系统自动创建高风险干预工单', {
      risk_score: payload.risk.score,
      status,
    });

    if (handlerUserId) {
      await this.createLog(tx, createdCase.id, 'auto_assign', null, '系统根据班级绑定自动分配给班主任', {
        handler_user_id: handlerUserId.toString(),
      });
    }

    return createdCase;
  }

  private async resolveCase(tx: any, caseId: bigint, note: string) {
    await tx.warning_cases.update({
      where: { id: caseId },
      data: {
        status: 'resolved',
        is_active: false,
        resolved_at: new Date(),
        handling_priority: 0,
      },
    });

    await this.createLog(tx, caseId, 'resolve', null, note);
  }

  private shouldManageCase(activeWarnings: any[], riskScore: number) {
    if (activeWarnings.some((warning: any) => warning.level === 'red' || warning.level === 'severe')) {
      return true;
    }
    return riskScore >= HIGH_RISK_THRESHOLD;
  }

  private shouldDelayReopen(lastClosedCase: any, latestWarningAt: Date | null, riskScore: number, sourceWarningIds: string[]) {
    const closedAtRaw = lastClosedCase?.completed_at || lastClosedCase?.resolved_at || null;
    if (
      !lastClosedCase
      || !['completed', 'resolved'].includes(String(lastClosedCase.status || ''))
      || !closedAtRaw
    ) {
      return false;
    }

    const completedAt = new Date(closedAtRaw).getTime();
    const latestWarningTime = latestWarningAt ? new Date(latestWarningAt).getTime() : 0;
    const previousSources = Array.isArray(lastClosedCase.source_warning_ids_json)
      ? lastClosedCase.source_warning_ids_json.map((item: any) => String(item)).sort()
      : [];
    const nextSources = [...sourceWarningIds].sort();

    return latestWarningTime <= completedAt
      && riskScore <= Number(lastClosedCase.risk_score || 0)
      && previousSources.join(',') === nextSources.join(',');
  }

  private pickPrimaryWarning(activeWarnings: any[]) {
    const sortedWarnings = [...activeWarnings].sort((left, right) => {
      const levelDiff = (WARNING_LEVEL_SCORES[right.level] || 0) - (WARNING_LEVEL_SCORES[left.level] || 0);
      if (levelDiff !== 0) {
        return levelDiff;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
    return sortedWarnings[0] || null;
  }

  private async calculateRisk(tx: any, studentId: bigint, activeWarnings: any[]) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const recentRecords = await tx.daily_records.findMany({
      where: {
        student_id: studentId,
        record_date: {
          gte: fourteenDaysAgo,
          lte: now,
        },
      },
      select: {
        record_date: true,
        attendance_status: true,
      },
    });

    const warningScore = Math.min(
      activeWarnings.reduce((sum: number, warning: any) => sum + (WARNING_LEVEL_SCORES[warning.level] || 0), 0),
      60,
    );

    let recentAbsentCount = 0;
    let recentLateCount = 0;
    let recentEarlyLeaveCount = 0;
    let recentWindowCount = 0;
    let previousWindowCount = 0;

    for (const record of recentRecords) {
      const recordTime = new Date(record.record_date).getTime();
      const isRecent = recordTime >= sevenDaysAgo.getTime();
      const isPrevious = recordTime >= fourteenDaysAgo.getTime() && recordTime < sevenDaysAgo.getTime();

      let abnormalCount = 0;

      if (record.attendance_status === 'absent') {
        if (isRecent) recentAbsentCount += 1;
        abnormalCount += 1;
      }
      if (record.attendance_status === 'late') {
        if (isRecent) recentLateCount += 1;
        abnormalCount += 1;
      }
      if (record.attendance_status === 'early_leave') {
        if (isRecent) recentEarlyLeaveCount += 1;
        abnormalCount += 1;
      }
      if (abnormalCount > 0) {
        if (isRecent) {
          recentWindowCount += abnormalCount;
        } else if (isPrevious) {
          previousWindowCount += abnormalCount;
        }
      }
    }

    const behaviorScore = Math.min(
      recentAbsentCount * 4 + recentLateCount * 2 + recentEarlyLeaveCount * 2,
      25,
    );

    let trendScore = 0;
    if (recentWindowCount >= 3 && previousWindowCount === 0) {
      trendScore = 8;
    } else if (previousWindowCount > 0) {
      const ratio = recentWindowCount / previousWindowCount;
      if (ratio >= 2 && recentWindowCount - previousWindowCount >= 2) {
        trendScore = 15;
      } else if (ratio >= 1.5) {
        trendScore = 8;
      }
    }

    const persistencePeriods = new Set(
      activeWarnings
        .filter((warning: any) => ['week', 'month', 'term'].includes(warning.window))
        .map((warning: any) => `${warning.window}:${new Date(warning.period_start).toISOString().slice(0, 10)}`),
    );

    let persistenceScore = 0;
    if (persistencePeriods.size >= 4) {
      persistenceScore = 15;
    } else if (persistencePeriods.size >= 2) {
      persistenceScore = 8;
    }

    const score = Math.min(warningScore + behaviorScore + trendScore + persistenceScore, 100);
    const levels = activeWarnings.reduce((summary: Record<string, number>, warning: any) => {
      summary[warning.level] = (summary[warning.level] || 0) + 1;
      return summary;
    }, {});

    return {
      score,
      breakdown: {
        warning_score: warningScore,
        behavior_score: behaviorScore,
        trend_score: trendScore,
        persistence_score: persistenceScore,
        recent_absent_count: recentAbsentCount,
        recent_late_count: recentLateCount,
        recent_early_leave_count: recentEarlyLeaveCount,
        recent_window_count: recentWindowCount,
        previous_window_count: previousWindowCount,
      },
      warningSummary: {
        active_warning_count: activeWarnings.length,
        levels,
      },
    };
  }

  private calculateHandlingPriority(
    riskScore: number,
    status: string,
    assignedAt?: Date | null,
    acceptedAt?: Date | null,
  ) {
    let priority = riskScore;
    const now = Date.now();

    if (status === 'pending_assignment') {
      priority += 15;
    } else if (status === 'pending_intervention') {
      priority += 10;
      if (assignedAt && now - new Date(assignedAt).getTime() > 24 * 60 * 60 * 1000) {
        priority += 5;
      }
    } else if (status === 'in_progress') {
      priority += 5;
      if (acceptedAt && now - new Date(acceptedAt).getTime() > 72 * 60 * 60 * 1000) {
        priority += 8;
      }
    }

    return Math.min(priority, 120);
  }

  private async buildCaseItems(cases: any[]) {
    if (cases.length === 0) {
      return [];
    }

    const studentIds = this.uniqueBigInts(cases.map((item: any) => item.student_id));
    const classIds = this.uniqueBigInts(cases.map((item: any) => item.class_id));
    const orgIds = this.uniqueBigInts(cases.map((item: any) => item.org_id));
    const handlerIds = this.uniqueBigInts(
      cases.map((item: any) => item.handler_user_id).filter((item: any): item is bigint => Boolean(item)),
    );

    const [students, classes, orgs, handlers] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          student_no: true,
          users: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          class_name: true,
        },
      }),
      this.prisma.orgs.findMany({
        where: { id: { in: orgIds } },
        select: {
          id: true,
          name: true,
        },
      }),
      handlerIds.length > 0
        ? this.prisma.users.findMany({
            where: { id: { in: handlerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const studentMap = new Map<string, any>(students.map((item: any) => [item.id.toString(), item]));
    const classMap = new Map<string, any>(classes.map((item: any) => [item.id.toString(), item]));
    const orgMap = new Map<string, any>(orgs.map((item: any) => [item.id.toString(), item]));
    const handlerMap = new Map<string, any>(handlers.map((item: any) => [item.id.toString(), item]));

    return cases.map((caseItem: any) => {
      const student = studentMap.get(caseItem.student_id.toString());
      const classInfo = classMap.get(caseItem.class_id.toString());
      const org = orgMap.get(caseItem.org_id.toString());
      const handler = caseItem.handler_user_id ? handlerMap.get(caseItem.handler_user_id.toString()) : null;
      const warningSummary = (caseItem.warning_summary_json as any) || {};
      const riskBreakdown = (caseItem.risk_breakdown_json as any) || {};

      return {
        id: caseItem.id.toString(),
        student_id: caseItem.student_id.toString(),
        student_no: student?.student_no || '',
        student_name: student?.users?.name || '未知学生',
        class_id: caseItem.class_id.toString(),
        class_name: classInfo?.class_name || '未知班级',
        org_id: caseItem.org_id.toString(),
        org_name: org?.name || '未知学院',
        risk_score: caseItem.risk_score,
        handling_priority: caseItem.handling_priority,
        status: caseItem.status,
        status_label: STATUS_LABELS[caseItem.status] || caseItem.status,
        status_tag_type: STATUS_TAG_TYPES[caseItem.status] || 'info',
        handler_user_id: caseItem.handler_user_id?.toString() || '',
        handler_name: handler?.name || '',
        assigned_at: caseItem.assigned_at,
        accepted_at: caseItem.accepted_at,
        completed_at: caseItem.completed_at,
        resolved_at: caseItem.resolved_at,
        completion_summary: caseItem.completion_summary || '',
        completion_detail_json: caseItem.completion_detail_json,
        latest_warning_at: caseItem.latest_warning_at,
        last_risk_at: caseItem.last_risk_at,
        is_active: caseItem.is_active,
        active_warning_count: Number(warningSummary.active_warning_count || 0),
        warning_levels: warningSummary.levels || {},
        risk_breakdown: riskBreakdown,
        source_warning_ids: Array.isArray(caseItem.source_warning_ids_json)
          ? caseItem.source_warning_ids_json.map((item: any) => String(item))
          : [],
        created_at: caseItem.created_at,
        updated_at: caseItem.updated_at,
      };
    });
  }

  private async createLog(
    client: any,
    caseId: bigint,
    action: string,
    actorUserId?: bigint | null,
    note?: string,
    detail?: any,
  ) {
    await client.warning_case_logs.create({
      data: {
        case_id: caseId,
        action,
        actor_user_id: actorUserId || null,
        note: note || null,
        detail_json: detail || null,
      },
    });
  }

  private async buildCaseWhere(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    query: {
      status?: string;
      keyword?: string;
      includeInactive?: boolean;
      orgId?: string;
      classId?: string;
      activeOnly?: boolean;
      handlerUserId?: string;
    } = {},
  ) {
    const where: any = {};
    const scopedOrgIds = access.orgScopeIds || [];
    const scopedClassIds = access.classScopeIds || [];

    if (query.activeOnly) {
      where.is_active = true;
    } else if (!query.includeInactive) {
      where.is_active = true;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.handlerUserId) {
      where.handler_user_id = BigInt(query.handlerUserId);
    }

    if (query.classId) {
      const classId = BigInt(query.classId);
      if (scopedClassIds.length > 0 && !scopedClassIds.some((item: any) => item.toString() === classId.toString())) {
        where.class_id = { in: [] };
        return where;
      }
      where.class_id = classId;
    } else if (scopedClassIds.length > 0) {
      where.class_id = { in: this.uniqueBigInts(scopedClassIds) };
    }

    if (query.orgId) {
      const orgId = BigInt(query.orgId);
      if (scopedOrgIds.length > 0 && !scopedOrgIds.some((item: any) => item.toString() === orgId.toString())) {
        where.org_id = { in: [] };
        return where;
      }
      where.org_id = orgId;
    } else if (scopedOrgIds.length > 0) {
      where.org_id = { in: this.uniqueBigInts(scopedOrgIds) };
    }

    if (query.keyword) {
      const keyword = query.keyword.trim();
      const students = await this.prisma.student_profiles.findMany({
        where: {
          OR: [
            { student_no: { contains: keyword } },
            { users: { is: { name: { contains: keyword } } } },
          ],
        },
        select: { id: true },
      });

      where.student_id = { in: students.map((item: any) => item.id) };
    }

    return where;
  }

  private assertCaseAccessible(
    access: {
      roles: string[];
      userId: bigint;
      orgScopeIds?: bigint[];
      classScopeIds?: bigint[];
    },
    caseItem: { class_id: bigint; org_id: bigint },
  ) {
    const scopedClassIds = access.classScopeIds || [];
    const scopedOrgIds = access.orgScopeIds || [];

    if (
      scopedClassIds.length > 0
      && !scopedClassIds.some((item: any) => item.toString() === caseItem.class_id.toString())
    ) {
      throw new Error('无权查看该工单');
    }

    if (
      scopedOrgIds.length > 0
      && !scopedOrgIds.some((item: any) => item.toString() === caseItem.org_id.toString())
    ) {
      throw new Error('无权查看该工单');
    }
  }

  private emptyCaseResult(page: number, pageSize: number) {
    return {
      total: 0,
      page,
      page_size: pageSize,
      items: [],
    };
  }

  private uniqueBigInts(values: Array<bigint | null | undefined>) {
    const map = new Map<string, bigint>();
    for (const value of values) {
      if (!value) {
        continue;
      }
      map.set(value.toString(), value);
    }
    return Array.from(map.values());
  }

  private normalizeBigIntValues(values: Array<bigint | string | number | null | undefined>) {
    const map = new Map<string, bigint>();
    for (const value of values) {
      if (value === null || value === undefined) {
        continue;
      }

      const raw = String(value).trim();
      if (!raw) {
        continue;
      }

      map.set(raw, BigInt(raw));
    }
    return Array.from(map.values());
  }

  private formatDate(value: Date) {
    return new Date(value).toISOString().split('T')[0].replace(/-/g, '/');
  }

  private isCaseDeletable(caseItem: { status?: string; is_active?: boolean }) {
    if (caseItem.is_active) {
      return false;
    }

    return ['completed', 'resolved'].includes(String(caseItem.status || ''));
  }

  private getActionLabel(action: string) {
    const map: Record<string, string> = {
      create: '创建工单',
      auto_assign: '自动分配',
      assign: '手动分配',
      accept: '确认接手',
      complete: '完成干预',
      resolve: '自动解除',
    };
    return map[action] || action;
  }
}
