import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';
import { Roles, RolesGuard } from '../shared/roles.guard';
import { WarningService } from '../warning/warning.service';

class CreateRuleDto {
  level!: string;
  window!: string;
  metric!: string;
  threshold!: number;
  scope?: string;
  scope_id?: bigint | number;
}

class UpdateRuleDto {
  enabled?: boolean;
  threshold?: number;
  notify_strategy_json?: object;
}

const ALLOWED_WARNING_METRICS = new Set(['late', 'absent', 'early_leave', 'warning_total']);

@Controller('warning-rules')
@UseGuards(AuthGuard, RolesGuard)
export class RulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
  ) {}

  @Get()
  @Roles('sys_admin', 'student_admin', 'teaching_admin')
  async listRules(@Req() req: any) {
    const rules = await this.prisma.warning_rules.findMany({
      where: {
        metric: { in: Array.from(ALLOWED_WARNING_METRICS) },
      },
      orderBy: [
        { metric: 'asc' },
        { window: 'asc' },
        { threshold: 'asc' },
        { updated_at: 'desc' },
      ],
    });

    return {
      code: 0,
      message: 'ok',
      data: rules.map((rule: any) => ({
        ...rule,
        id: rule.id.toString(),
        scope_id: rule.scope_id?.toString(),
        created_by: rule.created_by.toString(),
      })),
      trace_id: req.trace_id,
    };
  }

  @Post()
  @Roles('sys_admin', 'student_admin')
  async createRule(@Body() dto: CreateRuleDto, @Req() req: any) {
    if (!ALLOWED_WARNING_METRICS.has(String(dto.metric || '').trim())) {
      return {
        code: 400,
        message: '当前仅支持迟到、缺勤、早退、累计预警',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const existingRule = await this.prisma.warning_rules.findFirst({
      where: {
        scope: dto.scope || 'school',
        scope_id: dto.scope_id ? BigInt(dto.scope_id as any) : null,
        metric: dto.metric,
        window: dto.window,
        level: dto.level,
      },
    });

    if (existingRule) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const rule = await this.prisma.warning_rules.create({
      data: {
        scope: dto.scope || 'school',
        scope_id: dto.scope_id ? BigInt(dto.scope_id as any) : null,
        level: dto.level,
        window: dto.window,
        metric: dto.metric,
        threshold: dto.threshold,
        enabled: true,
        notify_strategy_json: {
          channels: ['email', 'wechat'],
          cooldown_hours: 24,
        },
        created_by: BigInt(req.user.userId),
      },
    });

    this.warningService.invalidateRulesCache();

    return {
      code: 0,
      message: '规则创建成功',
      data: {
        id: rule.id.toString(),
        warnings_generated: 'manual_recalc_recommended',
      },
      trace_id: req.trace_id,
    };
  }

  @Put(':id')
  @Roles('sys_admin', 'student_admin')
  async updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto, @Req() req: any) {
    const updateData: Record<string, any> = {};

    if (dto.enabled !== undefined) {
      updateData.enabled = dto.enabled;
    }
    if (dto.threshold !== undefined) {
      updateData.threshold = dto.threshold;
    }
    if (dto.notify_strategy_json) {
      updateData.notify_strategy_json = dto.notify_strategy_json;
    }

    const rule = await this.prisma.warning_rules.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    this.warningService.invalidateRulesCache();

    return {
      code: 0,
      message: '规则更新成功',
      data: {
        id: rule.id.toString(),
        warnings_generated: 'manual_recalc_recommended',
      },
      trace_id: req.trace_id,
    };
  }

  @Delete(':id')
  @Roles('sys_admin', 'student_admin')
  async deleteRule(@Param('id') id: string, @Req() req: any) {
    await this.prisma.warning_rules.delete({
      where: { id: BigInt(id) },
    });

    this.warningService.invalidateRulesCache();

    return {
      code: 0,
      message: '规则删除成功',
      data: {
        id,
        warnings_generated: 'manual_recalc_recommended',
      },
      trace_id: req.trace_id,
    };
  }
}

