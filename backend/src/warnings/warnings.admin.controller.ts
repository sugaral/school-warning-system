import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { DataScope, Permissions } from '../rbac/permission.decorator';
import { WarningSnapshotService } from '../warning/warning-snapshot.service';
import { WarningService } from '../warning/warning.service';
import { serializeForAudit } from '../shared/json.util';

class BatchDeleteWarningsDto {
  ids!: string[];
}

class ClearWarningsDto {
  scope?: string;
  org_id?: string;
  major?: string;
  class_id?: string;
  status?: string;
  course_id?: string;
  level?: string;
  batch_size?: number;
}

@Controller('admin/warnings')
@UseGuards(AuthGuard, PermissionGuard)
export class WarningsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warningSnapshotService: WarningSnapshotService,
    private readonly warningService: WarningService,
  ) {}

  private async deleteWarningRelations(tx: any, warningIds: bigint[]) {
    if (warningIds.length === 0) {
      return { deletedCount: 0 };
    }

    const notificationJobIds = (
      await tx.notification_jobs.findMany({
        where: { warning_id: { in: warningIds } },
        select: { id: true },
      })
    ).map((item: any) => item.id as bigint);

    if (notificationJobIds.length > 0) {
      await tx.notification_logs.deleteMany({
        where: { job_id: { in: notificationJobIds } },
      });
    }

    await tx.notification_jobs.deleteMany({
      where: { warning_id: { in: warningIds } },
    });

    const deleteResult = await tx.warnings.deleteMany({
      where: { id: { in: warningIds } },
    });

    return {
      deletedCount: deleteResult.count,
    };
  }

  private hasWarningAccess(dataScope: any, warning: { student_id: bigint; class_id: bigint | null; org_id: bigint | null }) {
    if (!dataScope) return false;
    if (dataScope.type === 'all') return true;

    if (dataScope.type === 'self' && dataScope.studentIds) {
      return dataScope.studentIds.some((sid: bigint) => sid.toString() === warning.student_id.toString());
    }
    if (dataScope.type === 'class' && dataScope.classIds) {
      return dataScope.classIds.some((cid: bigint) => cid.toString() === warning.class_id?.toString());
    }
    if (dataScope.type === 'college' && dataScope.collegeIds) {
      return dataScope.collegeIds.some((oid: bigint) => oid.toString() === warning.org_id?.toString());
    }
    return false;
  }

  @Get('student')
  @Permissions('warning:read')
  @DataScope({ entity: 'warning', field: 'student_id' })
  async getStudentWarnings(
    @Query('name') name: string,
    @Query('student_no') studentNo: string,
    @Req() req: any,
  ) {
    const student = await this.prisma.student_profiles.findFirst({
      where: {
        student_no: studentNo,
        users: { name },
      },
      include: {
        users: true,
        classes: true,
      },
    });

    if (!student) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const dataScope = req?.dataScope;
    const scopeWarning = {
      student_id: student.id,
      class_id: student.class_id,
      org_id: student.classes?.org_id ?? student.org_id ?? null,
    };
    if (!this.hasWarningAccess(dataScope, scopeWarning)) {
      return {
        code: 403,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const warnings = await this.prisma.warnings.findMany({
      where: { student_id: student.id },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        student: {
          id: student.id.toString(),
          name: student.users.name,
          student_no: student.student_no,
          class_name: student.classes?.class_name || '',
        },
        warnings: warnings.map((w) => ({
          id: w.id.toString(),
          level: w.level,
          window: w.window,
          period_start: w.period_start,
          period_end: w.period_end,
          trigger_summary: w.trigger_summary,
          status: w.status,
          created_at: w.created_at,
          acknowledged_at: w.acknowledged_at,
          closed_at: w.closed_at,
        })),
      },
      trace_id: req.trace_id,
    };
  }

  @Delete(':id')
  @Permissions('warning:manage')
  @DataScope({ entity: 'warning', field: 'id' })
  async deleteWarning(@Param('id') id: string, @Req() req: any) {
    const warningId = BigInt(id);
    const currentWarning = await (this.prisma as any).warning_current_states.findUnique({
      where: { id: warningId },
    });
    const historyWarning = currentWarning
      ? null
      : await this.prisma.warnings.findUnique({ where: { id: warningId } });
    const warning = currentWarning || historyWarning;

    if (!warning) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const dataScope = req?.dataScope;
    if (!this.hasWarningAccess(dataScope, warning)) {
      return { code: 403, message: '权限不足，无法删除该预警', data: null, trace_id: req.trace_id };
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: warning.student_id },
      include: { users: true },
    });

    await this.prisma.$transaction(async (tx) => {
      if (currentWarning) {
        await this.warningService.cleanupCurrentWarningNotificationJobs(tx, [currentWarning]);
        await (tx as any).warning_current_states.delete({
          where: { id: warningId },
        });
        return;
      }
      await this.deleteWarningRelations(tx, [warningId]);
    });
    await this.warningSnapshotService.refreshStudents([warning.student_id]);

    const actorUserId = BigInt(req.user?.userId || req.user?.sub || 0);
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action: 'warning.delete',
        entity_type: 'warning',
        entity_id: warningId,
        before_json: serializeForAudit(warning) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '删除成功',
      data: {
        deleted_id: id,
        student_name: student?.users?.name || '',
      },
      trace_id: req.trace_id,
    };
  }

  @Post('batch-delete')
  @Permissions('warning:manage')
  @DataScope({ entity: 'warning', field: 'ids' })
  async batchDeleteWarnings(@Body() dto: BatchDeleteWarningsDto, @Req() req: any) {
    const warningIds = (dto.ids || []).map((id) => BigInt(id));
    if (warningIds.length === 0) {
      return { code: 400, message: '请选择要删除的预警', data: null, trace_id: req.trace_id };
    }

    const [currentWarnings, historyWarnings] = await Promise.all([
      (this.prisma as any).warning_current_states.findMany({
        where: { id: { in: warningIds } },
      }),
      this.prisma.warnings.findMany({
        where: { id: { in: warningIds } },
      }),
    ]);
    const warnings = [...currentWarnings, ...historyWarnings];
    if (warnings.length === 0) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const dataScope = req?.dataScope;
    const allowedIds = warnings.filter((w) => this.hasWarningAccess(dataScope, w)).map((w) => w.id);
    if (allowedIds.length === 0) {
      return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const affectedStudentIds = warnings
      .filter((w) => allowedIds.some((id) => id.toString() === w.id.toString()))
      .map((w) => w.student_id);

    const currentIds = currentWarnings
      .filter((w: any) => allowedIds.some((id) => id.toString() === w.id.toString()))
      .map((w: any) => w.id);
    const historyIds = historyWarnings
      .filter((w: any) => allowedIds.some((id) => id.toString() === w.id.toString()))
      .map((w: any) => w.id);
    const deleteResult = await this.prisma.$transaction(async (tx) => {
      let deletedCount = 0;
      if (currentIds.length > 0) {
        const currentWarningsToDelete = currentWarnings.filter((w: any) =>
          allowedIds.some((id) => id.toString() === w.id.toString()),
        );
        await this.warningService.cleanupCurrentWarningNotificationJobs(tx, currentWarningsToDelete);
        const currentDeleteResult = await (tx as any).warning_current_states.deleteMany({
          where: { id: { in: currentIds } },
        });
        deletedCount += Number(currentDeleteResult.count || 0);
      }
      if (historyIds.length > 0) {
        const historyDeleteResult = await this.deleteWarningRelations(tx, historyIds);
        deletedCount += Number(historyDeleteResult.deletedCount || 0);
      }
      return { deletedCount };
    });
    await this.warningSnapshotService.refreshStudents(affectedStudentIds);

    const actorUserId = BigInt(req.user?.userId || req.user?.sub || 0);
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action: 'warning.batch_delete',
        entity_type: 'warning',
        entity_id: 0n,
        after_json: serializeForAudit({ deleted_count: deleteResult.deletedCount, warning_ids: allowedIds.map((id) => id.toString()) }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    const studentIds = Array.from(new Set(warnings.map((item) => item.student_id.toString()))).map((id) =>
      BigInt(id),
    );
    const students = studentIds.length
      ? await this.prisma.student_profiles.findMany({
          where: { id: { in: studentIds } },
          include: { users: true },
        })
      : [];
    const studentMap = new Map(students.map((item: any) => [item.id.toString(), item]));

    const deletedStudentNames = warnings
      .filter((w) => allowedIds.some((id) => id.toString() === w.id.toString()))
      .map((w) => (studentMap.get(w.student_id.toString()) as any)?.users?.name)
      .filter(Boolean);

    return {
      code: 0,
      message: `成功删除 ${deleteResult.deletedCount} 条预警`,
      data: {
        deleted_count: deleteResult.deletedCount,
        student_names: deletedStudentNames,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('clear')
  @Permissions('warning:manage')
  @DataScope({ entity: 'warning', field: 'id' })
  async clearWarnings(@Body() dto: ClearWarningsDto, @Req() req: any) {
    const dataScope = req?.dataScope;
    const historyWhere = await this.buildWarningWhere(dto, dataScope, 'history');
    const currentWhere = await this.buildWarningWhere(dto, dataScope, 'current');
    const batchSize = this.normalizeBatchSize(dto.batch_size);
    let deletedHistoryCount = 0;
    let deletedCurrentCount = 0;
    let roundCount = 0;
    const affectedStudentIds = new Set<string>();

    while (true) {
      const currentWarnings = await (this.prisma as any).warning_current_states.findMany({
        where: currentWhere,
        select: {
          id: true,
          student_id: true,
          class_id: true,
          org_id: true,
          metric: true,
          window: true,
          period_start: true,
          period_end: true,
          trigger_detail_json: true,
          status: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (currentWarnings.length === 0) {
        break;
      }

      const ids = currentWarnings.map((item: any) => item.id);
      for (const warning of currentWarnings) {
        affectedStudentIds.add(warning.student_id.toString());
      }
      const deleteResult = await this.prisma.$transaction(async (tx) => {
        await this.warningService.cleanupCurrentWarningNotificationJobs(tx, currentWarnings);
        return (tx as any).warning_current_states.deleteMany({
          where: { id: { in: ids } },
        });
      });

      deletedCurrentCount += Number(deleteResult?.count || 0);
      roundCount += 1;

      if (currentWarnings.length < batchSize) {
        break;
      }
    }

    while (true) {
      const warnings = await this.prisma.warnings.findMany({
        where: historyWhere,
        select: {
          id: true,
          student_id: true,
          class_id: true,
          org_id: true,
          metric: true,
          window: true,
          period_start: true,
          period_end: true,
          trigger_detail_json: true,
          status: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });

      if (warnings.length === 0) {
        break;
      }

      const ids = warnings.map((item) => item.id);
      for (const warning of warnings) {
        affectedStudentIds.add(warning.student_id.toString());
      }
      const deleteResult = await this.prisma.$transaction(async (tx) =>
        this.deleteWarningRelations(tx, ids),
      );

      deletedHistoryCount += deleteResult.deletedCount;
      roundCount += 1;

      if (warnings.length < batchSize) {
        break;
      }
    }

    const affectedStudentIdList = Array.from(affectedStudentIds).map((id) => BigInt(id));
    await this.warningSnapshotService.refreshStudents(affectedStudentIdList);

    const deletedCount = deletedCurrentCount + deletedHistoryCount;

    if (deletedCount > 0) {
      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: BigInt(req.user?.userId),
          action: 'warning.clear',
          entity_type: 'warning',
          entity_id: 0n,
          after_json: {
            deleted_count: deletedCount,
            scope: dto.scope || 'active',
            org_id: dto.org_id || null,
            major: dto.major || null,
            class_id: dto.class_id || null,
            status: dto.status || null,
            course_id: dto.course_id || null,
            level: dto.level || null,
            batch_size: batchSize,
            round_count: roundCount,
            deleted_current_count: deletedCurrentCount,
            deleted_history_count: deletedHistoryCount,
          } as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });
    }

    return {
      code: 0,
      message: `成功清理 ${deletedCount} 条预警`,
      data: {
        deleted_count: deletedCount,
        deleted_current_count: deletedCurrentCount,
        deleted_history_count: deletedHistoryCount,
        batch_size: batchSize,
        round_count: roundCount,
      },
      trace_id: req.trace_id,
    };
  }

  private async buildWarningWhere(
    dto: ClearWarningsDto,
    dataScope: any,
    table: 'history' | 'current' = 'history',
  ) {
    const where: any = {};
    const normalizedScope = String(dto.scope || 'active').trim().toLowerCase();
    const scopedOrgIds = this.uniqueBigInts(dataScope?.collegeIds || []);
    const scopedClassIds = this.uniqueBigInts(dataScope?.classIds || []);
    const scopedStudentIds = this.uniqueBigInts(dataScope?.studentIds || []);

    if (scopedOrgIds.length > 0) {
      where.org_id = { in: scopedOrgIds };
    }
    if (scopedClassIds.length > 0) {
      where.class_id = { in: scopedClassIds };
    }
    if (scopedStudentIds.length > 0) {
      where.student_id = { in: scopedStudentIds };
    }

    if (dto.status) {
      if (table === 'current' && dto.status === 'closed') {
        return { id: { in: [] as bigint[] } };
      }
      where.status = dto.status;
    } else if (normalizedScope === 'history') {
      if (table === 'current') {
        return { id: { in: [] as bigint[] } };
      }
      where.status = { in: ['closed'] };
    } else if (normalizedScope === 'all') {
      if (table === 'current') {
        where.status = { in: ['open', 'acknowledged'] };
      }
    } else {
      where.status = { in: ['open', 'acknowledged'] };
    }

    if (dto.level) {
      where.level = dto.level;
    }

    if (dto.class_id) {
      const selectedClassId = BigInt(dto.class_id);
      if (
        scopedClassIds.length > 0 &&
        !scopedClassIds.some((item) => item.toString() === selectedClassId.toString())
      ) {
        return { id: { in: [] as bigint[] } };
      }
      where.class_id = selectedClassId;
    } else if (dto.major) {
      const classes = await this.prisma.classes.findMany({
        where: {
          major: dto.major,
          ...(dto.org_id ? { org_id: BigInt(dto.org_id) } : {}),
          ...(scopedOrgIds.length > 0 ? { org_id: { in: scopedOrgIds } } : {}),
          ...(scopedClassIds.length > 0 ? { id: { in: scopedClassIds } } : {}),
        },
        select: { id: true },
      });

      if (classes.length === 0) {
        return { id: { in: [] as bigint[] } };
      }

      where.class_id = { in: classes.map((item) => item.id) };
    }

    if (dto.org_id) {
      const selectedOrgId = BigInt(dto.org_id);
      if (
        scopedOrgIds.length > 0 &&
        !scopedOrgIds.some((item) => item.toString() === selectedOrgId.toString())
      ) {
        return { id: { in: [] as bigint[] } };
      }

      if (!dto.major && !dto.class_id) {
        where.org_id = selectedOrgId;
      }
    }

    if (dto.course_id && dto.course_id !== 'all') {
      where.trigger_detail_json = {
        path: '$.course_id',
        equals: dto.course_id,
      };
    }

    return where;
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

  private normalizeBatchSize(value: number | undefined) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 5000;
    }
    return Math.min(20000, Math.max(500, Math.floor(parsed)));
  }
}
