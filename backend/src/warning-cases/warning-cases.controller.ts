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
import { AuthGuard } from '../shared/auth.guard';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { PrismaService } from '../shared/prisma.service';
import { Roles, RolesGuard } from '../shared/roles.guard';
import { WarningCasesService } from './warning-cases.service';
import { PinoLogger } from 'nestjs-pino';
import { serializeForAudit } from '../shared/json.util';

class AssignCaseDto {
  handler_user_id?: string;
  note?: string;
}

class CompleteCaseDto {
  completion_summary!: string;
  completion_detail?: string;
}

class BatchDeleteCaseDto {
  ids!: string[];
}

@Controller('warning-cases')
@UseGuards(AuthGuard, RolesGuard, PermissionGuard)
export class WarningCasesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warningCasesService: WarningCasesService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('WarningCasesController');
  }

  @Get()
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async listCases(
    @Query('status') status: string,
    @Query('keyword') keyword: string,
    @Query('page') page = '1',
    @Query('page_size') pageSize = '20',
    @Query('include_inactive') includeInactive = '0',
    @Query('org_id') orgId: string,
    @Query('class_id') classId: string,
    @Req() req: any,
  ) {
    const access = await this.getAccessScope(req);
    const parsedPage = parseInt(page, 10) || 1;
    const parsedPageSize = parseInt(pageSize, 10) || 20;

    if (!this.hasCaseAccessScope(access)) {
      return {
        code: 0,
        message: 'ok',
        data: {
          total: 0,
          page: parsedPage,
          page_size: parsedPageSize,
          items: [],
        },
        trace_id: req.trace_id,
      };
    }

    const result = await this.warningCasesService.listCases(access, {
      status,
      keyword,
      page: parsedPage,
      pageSize: parsedPageSize,
      includeInactive: includeInactive === '1',
      orgId,
      classId,
    });

    return {
      code: 0,
      message: 'ok',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Get('summary')
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async getSummary(
    @Query('status') status: string,
    @Query('keyword') keyword: string,
    @Query('include_inactive') includeInactive = '0',
    @Query('org_id') orgId: string,
    @Query('class_id') classId: string,
    @Req() req: any,
  ) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return {
        code: 0,
        message: 'ok',
        data: {
          total: 0,
          pendingAssignment: 0,
          pendingIntervention: 0,
          inProgress: 0,
          completed: 0,
          resolved: 0,
          avgRiskScore: 0,
          topRiskScore: 0,
        },
        trace_id: req.trace_id,
      };
    }

    const result = await this.warningCasesService.getCaseSummary(access, {
      status,
      keyword,
      includeInactive: includeInactive === '1',
      orgId,
      classId,
    });

    return {
      code: 0,
      message: 'ok',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Get('high-risk')
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async getHighRiskStudents(@Query('limit') limit = '10', @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return {
        code: 0,
        message: 'ok',
        data: {
          total: 0,
          items: [],
        },
        trace_id: req.trace_id,
      };
    }

    const result = await this.warningCasesService.getHighRiskStudents(
      access,
      parseInt(limit, 10) || 10,
    );

    return {
      code: 0,
      message: 'ok',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Post('batch-delete')
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async batchDeleteCases(@Body() dto: BatchDeleteCaseDto, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    try {
      const result = await this.warningCasesService.deleteCases(
        access,
        Array.isArray(dto.ids) ? dto.ids : [],
      );

      if (result.deleted_count > 0) {
        await this.prisma.audit_logs.create({
          data: {
            actor_user_id: access.userId,
            action: 'warning_case.batch_delete',
            entity_type: 'warning_case',
            entity_id: 0n,
            after_json: serializeForAudit(result) as any,
            ip: req.ip,
            user_agent: req.headers['user-agent']
              ? String(req.headers['user-agent']).slice(0, 255)
              : '',
          },
        });
      }

      return {
        code: 0,
        message:
          result.blocked.length > 0
            ? `已删除 ${result.deleted_count} 条，跳过 ${result.blocked.length} 条`
            : '删除成功',
        data: result,
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '批量删除失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Get(':id')
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async getCaseDetail(@Param('id') id: string, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    try {
      const result = await this.warningCasesService.getCaseDetail(access, BigInt(id));
      return {
        code: 0,
        message: 'ok',
        data: result,
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      const message = error?.message || '获取详情失败';
      return {
        code: message.includes('不存在') ? 404 : 403,
        message,
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Get(':id/logs')
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async getCaseLogs(@Param('id') id: string, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    try {
      const result = await this.warningCasesService.getCaseLogs(access, BigInt(id));
      return {
        code: 0,
        message: 'ok',
        data: result,
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      const message = error?.message || '获取日志失败';
      return {
        code: message.includes('不存在') ? 404 : 403,
        message,
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Post(':id/assign')
  @Roles('sys_admin', 'student_admin')
  async assignCase(@Param('id') id: string, @Body() dto: AssignCaseDto, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    const caseId = BigInt(id);
    const currentCase = await this.prisma.warning_cases.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        org_id: true,
      },
    });

    if (!currentCase) {
      return {
        code: 404,
        message: '工单不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      access.orgScopeIds.length > 0
      && !access.orgScopeIds.some((item) => item.toString() === currentCase.org_id.toString())
    ) {
      return this.forbidden(req.trace_id);
    }

    try {
      const result = await this.warningCasesService.assignCase(
        caseId,
        access.userId,
        dto.handler_user_id ? BigInt(dto.handler_user_id) : undefined,
        dto.note,
      );

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: access.userId,
          action: 'warning_case.assign',
          entity_type: 'warning_case',
          entity_id: result.id,
          after_json: serializeForAudit({ handler_user_id: dto.handler_user_id, note: dto.note }) as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });

      return {
        code: 0,
        message: '分配成功',
        data: { id: result.id.toString() },
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '分配失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Post(':id/accept')
  @Roles('head_teacher')
  async acceptCase(@Param('id') id: string, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    try {
      const result = await this.warningCasesService.acceptCase(
        BigInt(id),
        access.userId,
        access.classScopeIds,
      );

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: access.userId,
          action: 'warning_case.accept',
          entity_type: 'warning_case',
          entity_id: result.id,
          after_json: serializeForAudit({ status: 'in_progress' }) as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });

      return {
        code: 0,
        message: '确认接手成功',
        data: { id: result.id.toString() },
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '确认接手失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Post(':id/complete')
  @Permissions('warning:close')
  async completeCase(@Param('id') id: string, @Body() dto: CompleteCaseDto, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    if (!dto.completion_summary?.trim()) {
      return {
        code: 400,
        message: '请填写干预总结',
        data: null,
        trace_id: req.trace_id,
      };
    }

    try {
      const result = await this.warningCasesService.completeCase(
        BigInt(id),
        access.userId,
        dto.completion_summary.trim(),
        dto.completion_detail?.trim(),
      );

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: access.userId,
          action: 'warning_case.complete',
          entity_type: 'warning_case',
          entity_id: result.id,
          after_json: serializeForAudit({ completion_summary: dto.completion_summary }) as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });

      return {
        code: 0,
        message: '提交完成成功',
        data: { id: result.id.toString() },
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '提交失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Delete(':id')
  @Roles('sys_admin', 'student_admin', 'head_teacher')
  async deleteCase(@Param('id') id: string, @Req() req: any) {
    const access = await this.getAccessScope(req);
    if (!this.hasCaseAccessScope(access)) {
      return this.forbidden(req.trace_id);
    }

    try {
      const result = await this.warningCasesService.deleteCases(access, [id]);
      if (result.deleted_count === 0) {
        return {
          code: 400,
          message: result.blocked[0]?.reason || '删除失败',
          data: result,
          trace_id: req.trace_id,
        };
      }

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: access.userId,
          action: 'warning_case.delete',
          entity_type: 'warning_case',
          entity_id: BigInt(id),
          after_json: serializeForAudit({ deleted_id: id }) as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });

      return {
        code: 0,
        message: '删除成功',
        data: result,
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '删除失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  private async getAccessScope(req: any) {
    const userId = BigInt(req.user?.sub || req.user?.userId);
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });

    const roles = userRoles.map((item: any) => item.role);
    const orgScopeIds = userRoles
      .filter((item: any) => item.role === 'student_admin' && item.scope_id)
      .map((item: any) => item.scope_id as bigint);
    const classScopeIds = userRoles
      .filter((item: any) => item.role === 'head_teacher' && item.scope_id)
      .map((item: any) => item.scope_id as bigint);

    return {
      userId,
      roles,
      orgScopeIds,
      classScopeIds,
    };
  }

  private forbidden(traceId: string) {
    return {
      code: 403,
      message: '无权限执行该操作',
      data: null,
      trace_id: traceId,
    };
  }

  private hasCaseAccessScope(access: {
    roles: string[];
    orgScopeIds?: bigint[];
    classScopeIds?: bigint[];
  }) {
    if (access.roles.includes('sys_admin')) {
      return true;
    }

    const hasStudentAdminScope =
      access.roles.includes('student_admin') && (access.orgScopeIds?.length || 0) > 0;
    const hasHeadTeacherScope =
      access.roles.includes('head_teacher') && (access.classScopeIds?.length || 0) > 0;

    return hasStudentAdminScope || hasHeadTeacherScope;
  }
}
