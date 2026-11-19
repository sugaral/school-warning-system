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
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
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

/**
 * 允许配置的预警指标白名单。
 *
 * P1-6 扩展：原先只有 late/absent/early_leave/warning_total，
 * 导致 homework_status 与 class_behavior 两个字段即使有数据也无法配置规则。
 * 现补齐 daily_records 上的新指标（leave 可选，默认不建规则）。
 */
const ALLOWED_WARNING_METRICS = new Set([
  // 考勤类（默认启用）
  'late',
  'absent',
  'early_leave',
  // 累计预警数
  'warning_total',
  // 作业与课堂表现（P1-6 新增，依赖 POST /attendance/daily-records 录入入口）
  'homework_not_submit',
  'homework_late_submit',
  'class_behavior',
  // 请假：可选，默认不建规则（请假属经审批的合规行为，默认告警会大量误报）
  'leave',
  // ============================================================
  // §6.1.1 学期级指标（P1-5 学期汇总落地后具备数据源）
  // ⚠️ 阈值单位（必须与引擎的 TERM_METRIC_SCALE 一致，否则会 100 倍误配）：
  //    failed_courses  挂科门数，整数        → 阈值 3  表示 挂科 ≥ 3 门
  //    credits         已修学分，×10 定点   → 阈值 1200 表示 已修学分 < 120.0
  //    gpa             平均绩点，×100 定点  → 阈值 200  表示 GPA < 2.00
  // ============================================================
  'failed_courses',
  'credits',
  'gpa',
  // 超时未确认的预警条数
  'unacknowledged',
]);

/**
 * 引擎支持的时间窗口（§6.1.1 的 12 指标 × 4 窗口）
 *
 * ⚠️ 为什么必须显式校验：
 * createRule 原本**完全不校验 window/level/threshold**，直接落库。
 * 管理员（或前端 bug）传 `window: 'year'` 会成功创建一条永远不触发的规则
 * —— 界面上规则存在、看起来已配置、但引擎的 4 个窗口里没有 'year'，
 * 于是静默失效。这类"配了不生效"比报错更难排查。
 */
const ALLOWED_WINDOWS = new Set(['day', 'week', 'month', 'term']);

/** 预警级别：与 warning.service.ts 的 getWarningLevelText 映射一致 */
const ALLOWED_LEVELS = new Set(['yellow', 'orange', 'red', 'severe']);

/**
 * 只对特定窗口有意义的指标（防止配出永不触发的组合）
 *
 * - 学期级学业指标（挂科/学分/GPA）的数据源是 term_summaries，
 *   只有 term 窗口会去读它；配成 day/week/month 永远不会命中。
 * - 未确认预警数同理，按 windowType 之外只取 month 语义。
 */
const METRIC_WINDOW_RESTRICTION: Record<string, string[]> = {
  failed_courses: ['term'],
  credits: ['term'],
  gpa: ['term'],
};

/** 指标中文名（用于可读的报错信息） */
const METRIC_LABELS: Record<string, string> = {
  late: '迟到',
  absent: '缺勤',
  early_leave: '早退',
  warning_total: '累计预警',
  homework_not_submit: '作业未交',
  homework_late_submit: '作业迟交',
  class_behavior: '课堂表现',
  leave: '请假',
  failed_courses: '挂科门数',
  credits: '已修学分',
  gpa: '平均绩点',
  unacknowledged: '未确认预警',
};

@Controller('warning-rules')
@UseGuards(AuthGuard, RolesGuard, PermissionGuard)
export class RulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
  ) {}

  @Get()
  @Permissions('rule:read')
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
  @Permissions('rule:create')
  async createRule(@Body() dto: CreateRuleDto, @Req() req: any) {
    const metric = String(dto.metric || '').trim();
    const window = String(dto.window || '').trim();
    const level = String(dto.level || '').trim();

    if (!ALLOWED_WARNING_METRICS.has(metric)) {
      return {
        code: 400,
        // 报错信息动态列出全部受支持指标，避免与白名单漂移
        // （原先是硬编码的"仅支持迟到、缺勤、早退、累计预警"，
        //   白名单扩到 12 个指标后这句话仍然是 4 个，误导管理员）
        message: `不支持的预警指标：${metric || '(空)'}。当前支持：${Array.from(
          ALLOWED_WARNING_METRICS,
        )
          .map((m) => `${METRIC_LABELS[m] || m}(${m})`)
          .join('、')}`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!ALLOWED_WINDOWS.has(window)) {
      return {
        code: 400,
        message: `不支持的统计窗口：${window || '(空)'}。仅支持 day(日)、week(周)、month(月)、term(学期)`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!ALLOWED_LEVELS.has(level)) {
      return {
        code: 400,
        message: `不支持的预警级别：${level || '(空)'}。仅支持 yellow、orange、red、severe`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    const allowedWindowsForMetric = METRIC_WINDOW_RESTRICTION[metric];
    if (allowedWindowsForMetric && !allowedWindowsForMetric.includes(window)) {
      return {
        code: 400,
        message: `${METRIC_LABELS[metric] || metric}(${metric}) 只支持 ${allowedWindowsForMetric.join(
          '/',
        )} 窗口，配成 ${window} 永远不会触发`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    // threshold 必须是非负整数（DB 列是 Int，NaN 会直接报 500）
    const threshold = Number(dto.threshold);
    if (!Number.isInteger(threshold) || threshold < 0) {
      return {
        code: 400,
        message: `阈值必须是非负整数，收到：${JSON.stringify(dto.threshold)}`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    const existingRule = await this.prisma.warning_rules.findFirst({
      where: {
        scope: dto.scope || 'school',
        scope_id: dto.scope_id ? BigInt(dto.scope_id as any) : null,
        metric,
        window,
        level,
      },
    });

    if (existingRule) {
      return {
        code: 400,
        message: `已存在相同规则（指标=${METRIC_LABELS[metric] || metric}，窗口=${window}，级别=${level}），请直接修改该规则而不要重复创建`,
        data: null,
        trace_id: req.trace_id,
      };
    }

    const rule = await this.prisma.warning_rules.create({
      data: {
        scope: dto.scope || 'school',
        scope_id: dto.scope_id ? BigInt(dto.scope_id as any) : null,
        level,
        window,
        metric,
        threshold,
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
  @Permissions('rule:update')
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

    // P2-9 修复：任何影响判定的修改都必须让 rule_version + 1。
    // 修复前本接口**从不更新 rule_version**（实测：连改 10 次仍为 1），
    // 而历史预警是靠在生成时冻结的 `warnings.rule_snapshot_json` 来解释的。
    // 版本号不动，运营就无法区分「这条预警是按哪一版规则触发的」，
    // 也无法判断改阈值前后的影响面。
    //
    // 用原子 `increment` 而非「先读后写」，避免并发修改导致版本号丢失更新。
    const hasJudgementChange =
      dto.threshold !== undefined ||
      dto.enabled !== undefined ||
      dto.notify_strategy_json !== undefined;
    if (hasJudgementChange) {
      updateData.rule_version = { increment: 1 };
    }
    updateData.updated_at = new Date();

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
  @Permissions('rule:delete')
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

