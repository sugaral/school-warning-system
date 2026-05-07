import { Controller, Get, Post, Body, UseGuards, Req, Query } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';

class RuleOverrideDto {
  enabled!: boolean;
  gradeThreshold!: number;
  attendanceThreshold!: number;
  redThreshold!: number;
  orangeThreshold!: number;
  yellowThreshold!: number;
}

class NotificationStrategyDto {
  enabled!: boolean;
  notifyOnCreate!: boolean;
  notifyOnUpgrade!: boolean;
  notifyOnClose!: boolean;
  notifyStudent!: boolean;
  notifyHeadTeacher!: boolean;
  notifyCounselor!: boolean;
  notifyParents!: boolean;
  channels!: string[];
}

class BindOrgDto {
  org_id!: string;
}

@Controller('student-admin')
@UseGuards(AuthGuard, RolesGuard)
export class StudentAdminController {
  private readonly dashboardCacheTtlSeconds = 60;
  private readonly payloadCache = new Map<string, { data: any; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('StudentAdminController');
  }

  private async getCachedPayload<T>(cacheKey: string, loader: () => Promise<T>, ttlSeconds = this.dashboardCacheTtlSeconds) {
    const now = Date.now();
    const cached = this.payloadCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
    const data = await loader();
    this.payloadCache.set(cacheKey, { data, expiresAt: now + ttlSeconds * 1000 });
    return data;
  }

  private async resolveStudentAdminOrgId(userId: bigint) {
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: {
        role: true,
        scope_id: true,
      },
    });

    const role = userRoles.find((item: any) => item.role === 'student_admin' && item.scope_id);
    return role?.scope_id || null;
  }

  private getWeekRangeLabel(date: Date) {
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    const weekday = current.getDay();
    const offset = weekday === 0 ? 6 : weekday - 1;
    const weekStart = new Date(current.getTime() - offset * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    return {
      start: weekStart,
      end: weekEnd,
      label: `${weekStart.toISOString().split('T')[0].slice(5)}~${weekEnd.toISOString().split('T')[0].slice(5)}`,
    };
  }

  private clampPercentage(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(0, Math.min(100, Math.round(parsed)));
  }

  private normalizeRuleOverride(dto: RuleOverrideDto): RuleOverrideDto {
    const redThreshold = this.clampPercentage(dto?.redThreshold, 50);
    const orangeThreshold = this.clampPercentage(dto?.orangeThreshold, 60);
    const yellowThreshold = this.clampPercentage(dto?.yellowThreshold, 70);

    if (!(redThreshold <= orangeThreshold && orangeThreshold <= yellowThreshold)) {
      throw new Error('预警分级阈值需满足 红色 <= 橙色 <= 黄色');
    }

    return {
      enabled: dto?.enabled === true,
      gradeThreshold: this.clampPercentage(dto?.gradeThreshold, 60),
      attendanceThreshold: this.clampPercentage(dto?.attendanceThreshold, 70),
      redThreshold,
      orangeThreshold,
      yellowThreshold,
    };
  }

  private normalizeNotificationStrategy(dto: NotificationStrategyDto): NotificationStrategyDto {
    const channels = Array.from(
      new Set(
        (Array.isArray(dto?.channels) ? dto.channels : [])
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) => ['sms', 'email', 'wechat'].includes(item)),
      ),
    );

    if (dto?.enabled === true && channels.length === 0) {
      throw new Error('启用通知策略后，至少选择一个通知渠道');
    }

    const targets = [
      dto?.notifyStudent === true,
      dto?.notifyHeadTeacher === true,
      dto?.notifyCounselor === true,
      dto?.notifyParents === true,
    ];

    if (dto?.enabled === true && !targets.some(Boolean)) {
      throw new Error('启用通知策略后，至少选择一个通知对象');
    }

    return {
      enabled: dto?.enabled === true,
      notifyOnCreate: dto?.notifyOnCreate !== false,
      notifyOnUpgrade: dto?.notifyOnUpgrade !== false,
      notifyOnClose: dto?.notifyOnClose !== false,
      notifyStudent: dto?.notifyStudent !== false,
      notifyHeadTeacher: dto?.notifyHeadTeacher !== false,
      notifyCounselor: dto?.notifyCounselor !== false,
      notifyParents: dto?.notifyParents === true,
      channels,
    };
  }

  @Post('bind-org')
  @Roles('sys_admin', 'student_admin')
  async bindOrg(@Body() dto: BindOrgDto, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.userId);
    const orgId = BigInt(dto.org_id);
    
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    let studentAdminRole = userRoles.find((ur: any) => ur.role === 'student_admin');
    
    if (!studentAdminRole) {
      return {
        code: 400,
        message: '您不是学工管理员',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    await this.prisma.user_roles.update({
      where: { id: studentAdminRole.id },
      data: { scope_id: orgId }
    });
    
    await this.prisma.users.update({
      where: { id: userId },
      data: { org_id: orgId }
    });
    
    const updatedRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    return {
      code: 0,
      message: '绑定成功',
      data: updatedRoles.map((r: any) => ({
        id: r.id.toString(),
        role: r.role,
        scope_type: r.scope_type,
        scope_id: r.scope_id?.toString(),
      })),
      trace_id: req.trace_id,
    };
  }

  @Get('dashboard')
  @Roles('sys_admin', 'student_admin')
  async getDashboard(@Req() req: any) {
    await this.prisma.ensureConnected();
    const userId = BigInt(req.user.userId);
    const orgId = await this.resolveStudentAdminOrgId(userId);

    if (!orgId) {
      return {
        code: 400,
        message: '请先绑定学院',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const data = await this.getCachedPayload(
      `student-admin:dashboard:${orgId.toString()}`,
      async () => {
        const today = new Date();
        const trendStart = new Date(today);
        trendStart.setHours(0, 0, 0, 0);
        trendStart.setDate(trendStart.getDate() - 6);

        const [totalStudents, warningGroups, classes, classStudentCounts, recentWarnings] = await Promise.all([
          this.prisma.student_profiles.count({
            where: {
              classes: {
                org_id: orgId,
              },
            },
          }),
          this.prisma.warnings.groupBy({
            by: ['level', 'status', 'class_id'],
            where: {
              org_id: orgId,
            },
            _count: {
              id: true,
            },
          }),
          this.prisma.classes.findMany({
            where: { org_id: orgId, status: 'active' },
            select: {
              id: true,
              class_name: true,
              major: true,
              enroll_year: true,
            },
          }),
          this.prisma.student_profiles.groupBy({
            by: ['class_id'],
            where: {
              classes: {
                org_id: orgId,
              },
            },
            _count: {
              id: true,
            },
          }),
          this.prisma.warnings.findMany({
            where: {
              org_id: orgId,
              created_at: {
                gte: trendStart,
              },
            },
            select: {
              created_at: true,
              level: true,
            },
          }),
        ]);

        let warningCount = 0;
        let seriousWarning = 0;
        let closedWarning = 0;
        let yellowWarning = 0;
        let orangeWarning = 0;
        let redWarning = 0;
        const classWarningMap = new Map<string, number>();

        warningGroups.forEach((item: any) => {
          const count = Number(item._count?.id || 0);
          const level = String(item.level || '').trim().toLowerCase();
          const status = String(item.status || '').trim().toLowerCase();
          const classKey = item.class_id?.toString?.() || '';

          if (status === 'closed') {
            closedWarning += count;
          } else if (status === 'open' || status === 'acknowledged') {
            warningCount += count;
            if (classKey) {
              classWarningMap.set(classKey, (classWarningMap.get(classKey) || 0) + count);
            }
            if (level === 'yellow' || level === 'low') {
              yellowWarning += count;
            } else if (level === 'orange') {
              orangeWarning += count;
            } else if (level === 'red' || level === 'high') {
              redWarning += count;
              seriousWarning += count;
            } else if (level === 'severe' || level === 'critical') {
              redWarning += count;
              seriousWarning += count;
            }
          }
        });

        const classStudentCountMap = new Map(
          classStudentCounts.map((item: any) => [
            item.class_id.toString(),
            Number(item._count?.id || 0),
          ]),
        );

        const classWarningStats = classes.map((cls: any) => {
          const studentCount = classStudentCountMap.get(cls.id.toString()) || 0;
          const classWarnings = classWarningMap.get(cls.id.toString()) || 0;
          return {
            class_id: cls.id.toString(),
            class_name: cls.class_name,
            major: cls.major,
            enroll_year: cls.enroll_year,
            student_count: studentCount,
            warning_count: classWarnings,
            warning_rate: studentCount > 0 ? `${((classWarnings / studentCount) * 100).toFixed(1)}%` : '0%',
          };
        });

        const majorStatsMap = new Map<string, { student_count: number; warning_count: number }>();
        classWarningStats.forEach((item: any) => {
          const key = String(item.major || '').trim();
          if (!key) {
            return;
          }
          const current = majorStatsMap.get(key) || { student_count: 0, warning_count: 0 };
          current.student_count += Number(item.student_count || 0);
          current.warning_count += Number(item.warning_count || 0);
          majorStatsMap.set(key, current);
        });

        const majorWarningStats = Array.from(majorStatsMap.entries()).map(([major, item]) => ({
          major,
          student_count: item.student_count,
          warning_count: item.warning_count,
          warning_rate:
            item.student_count > 0
              ? `${((item.warning_count / item.student_count) * 100).toFixed(1)}%`
              : '0%',
        }));

        const levelDistribution = [
          { level: '黄色预警', count: yellowWarning, color: '#d4a017' },
          { level: '橙色预警', count: orangeWarning, color: '#f97316' },
          { level: '红色预警', count: redWarning, color: '#dc2626' },
        ];

        const dates: string[] = [];
        for (let i = 6; i >= 0; i -= 1) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          dates.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
        }

        const yellowTrend = new Array(7).fill(0);
        const orangeTrend = new Array(7).fill(0);
        const redTrend = new Array(7).fill(0);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        recentWarnings.forEach((warning: any) => {
          const warningDate = new Date(warning.created_at);
          warningDate.setHours(0, 0, 0, 0);
          const daysAgo = Math.floor(
            (todayStart.getTime() - warningDate.getTime()) / (24 * 60 * 60 * 1000),
          );
          if (daysAgo < 0 || daysAgo > 6) {
            return;
          }

          const index = 6 - daysAgo;
          if (warning.level === 'yellow' || warning.level === 'low') {
            yellowTrend[index] += 1;
          } else if (warning.level === 'orange') {
            orangeTrend[index] += 1;
          } else if (
            warning.level === 'red' ||
            warning.level === 'high' ||
            warning.level === 'severe' ||
            warning.level === 'critical'
          ) {
            redTrend[index] += 1;
          }
        });

        const trendData = [
          { label: '黄色预警', color: '#d4a017', data: yellowTrend },
          { label: '橙色预警', color: '#f97316', data: orangeTrend },
          { label: '红色预警', color: '#dc2626', data: redTrend },
        ];

        return {
          totalStudents,
          warningCount,
          seriousWarning,
          closedWarning,
          yellowWarning,
          orangeWarning,
          redWarning,
          levelDistribution,
          classWarningStats,
          majorWarningStats,
          trendData,
          dates,
        };
      },
    );

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('rules-override')
  @Roles('sys_admin', 'student_admin')
  async getRulesOverride(@Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.userId);
    
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    let orgId: bigint | null = null;
    
    for (const ur of userRoles) {
      if (ur.role === 'student_admin' && ur.scope_id) {
        orgId = ur.scope_id;
        break;
      }
    }
    
    const ruleSettings = await this.prisma.system_settings.findFirst({
      where: { 
        setting_key: orgId ? `rules_override_${orgId}` : 'rules_override' 
      }
    });
    
    let data: RuleOverrideDto = {
      enabled: false,
      gradeThreshold: 60,
      attendanceThreshold: 70,
      redThreshold: 50,
      orangeThreshold: 60,
      yellowThreshold: 70
    };
    
    if (ruleSettings) {
      try {
        data = JSON.parse(ruleSettings.setting_val);
      } catch (e) {
        this.logger.error({ err: e }, '解析规则覆盖配置失败');
      }
    }
    
    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Post('rules-override')
  @Roles('sys_admin', 'student_admin')
  async setRulesOverride(@Body() dto: RuleOverrideDto, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.userId);
    
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    let orgId: bigint | null = null;
    
    for (const ur of userRoles) {
      if (ur.role === 'student_admin' && ur.scope_id) {
        orgId = ur.scope_id;
        break;
      }
    }
    
    let normalized: RuleOverrideDto;
    try {
      normalized = this.normalizeRuleOverride(dto);
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '规则覆盖配置不合法',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const settingKey = orgId ? `rules_override_${orgId}` : 'rules_override';
    const settingValue = JSON.stringify(normalized);
    
    await this.prisma.system_settings.upsert({
      where: { setting_key: settingKey },
      update: { setting_val: settingValue },
      create: { setting_key: settingKey, setting_val: settingValue },
    });
    
    return {
      code: 0,
      message: '保存成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('notification-strategy')
  @Roles('sys_admin', 'student_admin')
  async getNotificationStrategy(@Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.userId);
    
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    let orgId: bigint | null = null;
    
    for (const ur of userRoles) {
      if (ur.role === 'student_admin' && ur.scope_id) {
        orgId = ur.scope_id;
        break;
      }
    }
    
    const strategySettings = await this.prisma.system_settings.findFirst({
      where: { 
        setting_key: orgId ? `notification_strategy_${orgId}` : 'notification_strategy' 
      }
    });
    
    let data: NotificationStrategyDto = {
      enabled: true,
      notifyOnCreate: true,
      notifyOnUpgrade: true,
      notifyOnClose: true,
      notifyStudent: true,
      notifyHeadTeacher: true,
      notifyCounselor: true,
      notifyParents: false,
      channels: ['sms', 'wechat']
    };
    
    if (strategySettings) {
      try {
        data = JSON.parse(strategySettings.setting_val);
      } catch (e) {
        this.logger.error({ err: e }, '解析通知策略配置失败');
      }
    }
    
    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Post('notification-strategy')
  @Roles('sys_admin', 'student_admin')
  async setNotificationStrategy(@Body() dto: NotificationStrategyDto, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.userId);
    
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    let orgId: bigint | null = null;
    
    for (const ur of userRoles) {
      if (ur.role === 'student_admin' && ur.scope_id) {
        orgId = ur.scope_id;
        break;
      }
    }
    
    let normalized: NotificationStrategyDto;
    try {
      normalized = this.normalizeNotificationStrategy(dto);
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '通知策略配置不合法',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const settingKey = orgId ? `notification_strategy_${orgId}` : 'notification_strategy';
    const settingValue = JSON.stringify(normalized);
    
    await this.prisma.system_settings.upsert({
      where: { setting_key: settingKey },
      update: { setting_val: settingValue },
      create: { setting_key: settingKey, setting_val: settingValue },
    });
    
    return {
      code: 0,
      message: '保存成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('stats-1')
  @Roles('sys_admin', 'student_admin')
  async getCollegeStats1(@Req() req: any) {
    await this.prisma.ensureConnected();
    const userId = BigInt(req.user.userId);
    const orgId = await this.resolveStudentAdminOrgId(userId);

    if (!orgId) {
      return {
        code: 400,
        message: '请先绑定学院',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    const data = await this.getCachedPayload(
      `student-admin:stats-1:${orgId.toString()}`,
      async () => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const warningsWhere = {
          org_id: orgId,
          created_at: {
            gte: thirtyDaysAgo,
          },
        };

        const [levelDistribution, resolvedWarnings1, allWarnings1, classes, studentCount] = await Promise.all([
          this.prisma.warnings.groupBy({
            by: ['level', 'status'],
            where: warningsWhere,
            _count: {
              id: true,
            },
          }),
          this.prisma.warnings.findMany({
            where: {
              ...warningsWhere,
              OR: [
                { status: 'closed', closed_at: { not: null } },
                { status: 'acknowledged', acknowledged_at: { not: null } }
              ],
            },
            select: {
              created_at: true,
              closed_at: true,
              acknowledged_at: true,
              status: true,
            },
          }),
          this.prisma.warnings.findMany({
            where: warningsWhere,
            select: {
              id: true,
              level: true,
              status: true,
              created_at: true,
              closed_at: true,
              class_id: true,
            },
          }),
          this.prisma.classes.findMany({
            where: { org_id: orgId, status: 'active' },
            select: {
              id: true,
              class_name: true,
            },
          }),
          this.prisma.student_profiles.count({
            where: {
              classes: {
                org_id: orgId
              }
            }
          }),
        ]);

    const classStudentCounts = classes.length > 0
      ? await this.prisma.student_profiles.groupBy({
          by: ['class_id'],
          where: {
            class_id: {
              in: classes.map((item: any) => item.id),
            },
          },
          _count: {
            id: true,
          },
        })
      : [];

    const classStudentCountMap = new Map(
      classStudentCounts
        .filter((item: any) => item.class_id)
        .map((item: any) => [item.class_id.toString(), Number(item._count.id || 0)]),
    );

    const classStatsMap = new Map();
    classes.forEach((cls: any) => {
      classStatsMap.set(cls.id, {
        id: cls.id,
        className: cls.class_name,
        total_warnings: 0,
        closed_count: 0,
        red_count: 0,
        yellow_count: 0,
      });
    });

    allWarnings1.forEach((warning: any) => {
      if (warning.class_id && classStatsMap.has(warning.class_id)) {
        const stat = classStatsMap.get(warning.class_id)!;
        stat.total_warnings++;
        if (warning.status === 'closed' || warning.status === 'acknowledged') {
          stat.closed_count++;
        }
        if (warning.level === 'red' || warning.level === 'high') {
          stat.red_count++;
        } else if (warning.level === 'yellow' || warning.level === 'low') {
          stat.yellow_count++;
        }
      }
    });

    const classStats = Array.from(classStatsMap.values());

    let yellowCount = 0;
    let orangeCount = 0;
    let redCount = 0;
    let severeCount = 0;

    levelDistribution.forEach((item: any) => {
      const count = item._count.id;
      if (item.level === 'yellow' || item.level === 'low') {
        yellowCount += count;
      } else if (item.level === 'orange') {
        orangeCount += count;
      } else if (item.level === 'red' || item.level === 'high') {
        redCount += count;
      } else if (item.level === 'severe' || item.level === 'critical') {
        severeCount += count;
      }
    });

    const totalWarnings = allWarnings1.length;

    let avgResolutionTime = 0;
    let slaComplianceRate = 0;
    const slaStats = {
      twentyFour: 0,
      twentyFourCount: 0,
      three: 0,
      threeCount: 0,
      seven: 0,
      sevenCount: 0,
      over: 0,
      overCount: 0,
    };

    if (resolvedWarnings1.length > 0) {
      const resolutionTimes = resolvedWarnings1.map((w: any) => {
        const resolveTime = w.status === 'closed' && w.closed_at ? w.closed_at : 
                          w.status === 'acknowledged' && w.acknowledged_at ? w.acknowledged_at : null;
        if (resolveTime) {
          const hours = (resolveTime.getTime() - w.created_at.getTime()) / (1000 * 60 * 60);
          return hours;
        }
        return 0;
      }).filter((t: any) => t >= 0);

      if (resolutionTimes.length > 0 || totalWarnings > 0) {
        if (resolutionTimes.length > 0) {
          avgResolutionTime = resolutionTimes.reduce((a: any, b: any) => a + b, 0) / resolutionTimes.length;
        }
        
        const twentyFourCount = resolutionTimes.filter((t: any) => t <= 24).length;
        const threeCount = resolutionTimes.filter((t: any) => t > 24 && t <= 72).length;
        const sevenCount = resolutionTimes.filter((t: any) => t > 72 && t <= 168).length;
        const overCount = resolutionTimes.filter((t: any) => t > 168).length;
        const total = totalWarnings > 0 ? totalWarnings : 1; // Avoid division by zero

        slaStats.twentyFour = Math.round((twentyFourCount / total) * 100);
        slaStats.twentyFourCount = twentyFourCount;
        slaStats.three = Math.round((threeCount / total) * 100);
        slaStats.threeCount = threeCount;
        slaStats.seven = Math.round((sevenCount / total) * 100);
        slaStats.sevenCount = sevenCount;
        slaStats.over = Math.round((overCount / total) * 100);
        slaStats.overCount = overCount;

        const slaCount = resolutionTimes.filter((t: any) => t <= 168).length;
        slaComplianceRate = (slaCount / total) * 100;
      }
    }

    const classMap = new Map<bigint, { 
      id: bigint;
      className: string; 
      total_warnings: number; 
      closed_count: number; 
      red_count: number;
      yellow_count: number;
      trend: number[];
      trend_points: string;
    }>();
    
    classStats.forEach((cls: any) => {
      classMap.set(cls.id, {
        id: cls.id,
        className: cls.className || '未知班级',
        total_warnings: Number(cls.total_warnings) || 0,
        closed_count: Number(cls.closed_count) || 0,
        red_count: Number(cls.red_count) || 0,
        yellow_count: Number(cls.yellow_count) || 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
        trend_points: '',
      });
    });

    allWarnings1.forEach((warning: any) => {
      const classId = warning.class_id;
      if (classId && classMap.has(classId)) {
        const cls = classMap.get(classId)!;
        const daysAgo = Math.floor((Date.now() - warning.created_at.getTime()) / (24 * 60 * 60 * 1000));
        if (daysAgo >= 0 && daysAgo < 7) {
          cls.trend[6 - daysAgo]++;
        }
      }
    });

    const classPerformance = Array.from(classMap.values())
      .map(cls => {
        const maxTrend = Math.max(...cls.trend, 1);
        const points = cls.trend.map((value, index) => {
          const x = index * 13 + 5;
          const y = 35 - (value / maxTrend) * 30;
          return `${x},${y}`;
        }).join(' ');

        const resolveRate = cls.total_warnings > 0 ? Math.round((cls.closed_count / cls.total_warnings) * 100) : 0;
        
        return {
          className: cls.className,
          studentCount: classStudentCountMap.get(cls.id.toString()) || 0,
          warningCount: cls.total_warnings,
          redCount: cls.red_count,
          yellowCount: cls.yellow_count,
          resolveRate,
          avgResponse: avgResolutionTime > 0 ? Math.round(avgResolutionTime / 24 * 10) / 10 : 0,
          trendPoints: points,
          status: resolveRate >= 75 ? '达标' : '待改进',
        };
      })
      .sort((a, b) => b.warningCount - a.warningCount);

        return {
          warningStats: {
            yellow: yellowCount,
            orange: orangeCount,
            red: redCount,
            severe: severeCount,
          },
          totalWarnings,
          slaComplianceRate: Math.round(slaComplianceRate),
          slaStats,
          classPerformance,
        };
      },
    );

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('stats-2')
  @Roles('sys_admin', 'student_admin')
  async getCollegeStats2(@Query('timeRange') timeRange: string = 'month', @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.userId);
    
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId }
    });
    
    let orgId: bigint | null = null;
    
    for (const ur of userRoles) {
      if (ur.role === 'student_admin' && ur.scope_id) {
        orgId = ur.scope_id;
        break;
      }
    }
    
    if (!orgId) {
      return {
        code: 400,
        message: '请先绑定学院',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    
    let trendStartDate: Date;
    let labels: string[] = [];
    
    if (timeRange === 'day') {
      trendStartDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        labels.push(date.toISOString().split('T')[0].replace(/-/g, '/'));
      }
    } else if (timeRange === 'week') {
      const currentWeek = this.getWeekRangeLabel(new Date());
      trendStartDate = new Date(currentWeek.start.getTime() - 11 * 7 * 24 * 60 * 60 * 1000);
      for (let i = 11; i >= 0; i--) {
        const weekStart = new Date(currentWeek.start.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        labels.push(this.getWeekRangeLabel(weekStart).label);
      }
    } else {
      const monthCursor = new Date();
      monthCursor.setDate(1);
      monthCursor.setMonth(monthCursor.getMonth() - 5);
      trendStartDate = new Date(monthCursor);
      for (let i = 0; i < 6; i++) {
        labels.push(`${monthCursor.getFullYear()}/${String(monthCursor.getMonth() + 1).padStart(2, '0')}`);
        monthCursor.setMonth(monthCursor.getMonth() + 1);
      }
    }
    
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const twelveMonthsAgo = new Date(Date.now() - 360 * 24 * 60 * 60 * 1000);

    const [allWarnings, redWarnings, yellowWarnings, resolvedWarnings, pendingWarnings, recentStudentWarnings, monthlyTrend, allWarningsForClass, classes,
           prevAllWarnings, prevRedWarnings, prevYellowWarnings, prevResolvedWarnings, prevPendingWarnings, prevHighRiskStudentRows] = await Promise.all([
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          created_at: {
            gte: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          OR: [{ level: 'red' }, { level: 'high' }],
          created_at: {
            gte: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          OR: [{ level: 'yellow' }, { level: 'low' }],
          created_at: {
            gte: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          OR: [{ status: 'closed' }, { status: 'acknowledged' }],
          created_at: {
            gte: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          NOT: {
            OR: [{ status: 'closed' }, { status: 'acknowledged' }],
          },
          created_at: {
            gte: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.findMany({
        where: {
          org_id: orgId,
          student_id: {
            gt: BigInt(0),
          },
          created_at: {
            gte: thirtyDaysAgo,
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        select: {
          student_id: true,
          created_at: true,
          level: true,
          status: true,
        },
      }),
      this.prisma.warnings.findMany({
        where: {
          org_id: orgId,
          created_at: {
            gte: trendStartDate,
          },
        },
        select: {
          created_at: true,
          level: true,
          status: true,
        },
      }),
      this.prisma.warnings.findMany({
        where: {
          org_id: orgId,
          created_at: {
            gte: sixMonthsAgo,
          },
        },
        select: {
          level: true,
          class_id: true,
        },
      }),
      this.prisma.classes.findMany({
        where: { org_id: orgId, status: 'active' },
        select: {
          id: true,
          class_name: true,
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          created_at: {
            gte: twelveMonthsAgo,
            lt: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          OR: [{ level: 'red' }, { level: 'high' }],
          created_at: {
            gte: twelveMonthsAgo,
            lt: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          OR: [{ level: 'yellow' }, { level: 'low' }],
          created_at: {
            gte: twelveMonthsAgo,
            lt: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          OR: [{ status: 'closed' }, { status: 'acknowledged' }],
          created_at: {
            gte: twelveMonthsAgo,
            lt: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.count({
        where: {
          org_id: orgId,
          NOT: {
            OR: [{ status: 'closed' }, { status: 'acknowledged' }],
          },
          created_at: {
            gte: twelveMonthsAgo,
            lt: sixMonthsAgo,
          },
        },
      }),
      this.prisma.warnings.findMany({
        where: {
          org_id: orgId,
          OR: [{ level: 'red' }, { level: 'high' }],
          student_id: {
            gt: BigInt(0),
          },
          created_at: {
            gte: twelveMonthsAgo,
            lt: sixMonthsAgo,
          },
        },
        select: {
          student_id: true,
        },
      }),
    ]);

    const [activeHighRiskCount, activeHighRiskCases] = await Promise.all([
      this.prisma.warning_cases.count({
        where: {
          org_id: orgId,
          is_active: true,
          status: { not: 'resolved' },
        },
      }),
      this.prisma.warning_cases.findMany({
        where: {
          org_id: orgId,
          is_active: true,
          status: { not: 'resolved' },
        },
        orderBy: [{ risk_score: 'desc' }, { updated_at: 'desc' }],
        take: 10,
        select: {
          student_id: true,
          latest_warning_at: true,
          risk_score: true,
          status: true,
          warning_summary_json: true,
        },
      }),
    ]);

    const caseStatusTextMap: Record<string, string> = {
      pending_assignment: '待分配',
      pending_intervention: '待干预',
      in_progress: '处理中',
      completed: '处理完成',
      resolved: '已解除',
    };
    const caseStatusTypeMap: Record<string, string> = {
      pending_assignment: 'danger',
      pending_intervention: 'warning',
      in_progress: 'info',
      completed: 'success',
      resolved: 'info',
    };

    const highRiskStudentIds = activeHighRiskCases.map((item: any) => item.student_id);
    const students = highRiskStudentIds.length
      ? await this.prisma.student_profiles.findMany({
          where: { id: { in: highRiskStudentIds } },
          include: { users: true, classes: true },
        })
      : [];

    const studentMap = new Map(students.map((s: any) => [s.id.toString(), s]));

    const highRiskStudents = activeHighRiskCases.map((item: any) => {
      const student = studentMap.get(item.student_id.toString()) as any;
      const warningSummary = (item.warning_summary_json as any) || {};
      return {
        student_id: item.student_id,
        created_at: item.latest_warning_at,
        user_id: student?.user_id,
        student_no: student?.student_no,
        student_name: student?.users?.name,
        class_name: student?.classes?.class_name,
        risk_score: Number(item.risk_score || 0),
        warning_count: Number(warningSummary.active_warning_count || 0),
        status: caseStatusTextMap[item.status] || item.status || '待关注',
        status_type: caseStatusTypeMap[item.status] || 'info',
      };
    });

    const classMap = new Map();
    classes.forEach((cls: any) => {
      classMap.set(cls.id, {
        class_name: cls.class_name,
        red_count: 0,
        yellow_count: 0,
      });
    });

    allWarningsForClass.forEach((warning: any) => {
      if (warning.class_id && classMap.has(warning.class_id)) {
        const cls = classMap.get(warning.class_id)!;
        if (warning.level === 'red' || warning.level === 'high') {
          cls.red_count++;
        } else if (warning.level === 'yellow' || warning.level === 'low') {
          cls.yellow_count++;
        }
      }
    });

    const classDistribution = Array.from(classMap.values())
      .sort((a, b) => (b.red_count + b.yellow_count) - (a.red_count + a.yellow_count))
      .slice(0, 6);

    const trendDataMap = new Map<string, { total: number; red: number; yellow: number; resolved: number }>();
    labels.forEach(label => {
      trendDataMap.set(label, { total: 0, red: 0, yellow: 0, resolved: 0 });
    });

    monthlyTrend.forEach((warning: any) => {
      const date = warning.created_at;
      let key: string;
      
      if (timeRange === 'day') {
        key = date.toISOString().split('T')[0].replace(/-/g, '/');
      } else if (timeRange === 'week') {
        key = this.getWeekRangeLabel(date).label;
      } else {
        key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
      }
      
      if (trendDataMap.has(key)) {
        const data = trendDataMap.get(key)!;
        data.total++;
        if (warning.level === 'red' || warning.level === 'high') {
          data.red++;
        } else if (warning.level === 'yellow' || warning.level === 'low') {
          data.yellow++;
        }
        if (warning.status === 'closed' || warning.status === 'acknowledged') {
          data.resolved++;
        }
      }
    });

    const studentsList = highRiskStudents.map((w: any, index: number) => {
      return {
        id: w.student_no || (w.student_id ? String(w.student_id) : ''),
        name: w.student_name || '未命名学生',
        className: w.class_name || '未分班',
        riskScore: Number(w.risk_score || 0),
        warningCount: Number(w.warning_count || 0),
        lastWarning: w.created_at ? new Date(w.created_at).toISOString().split('T')[0].replace(/-/g, '/') : '',
        status: w.status || '待关注',
        statusType: w.status_type || 'info',
      };
    });

    const classData = {
      classes: classDistribution.map((d: any) => d.class_name || '未知班级'),
      red: classDistribution.map((d: any) => Number(d.red_count) || 0),
      yellow: classDistribution.map((d: any) => Number(d.yellow_count) || 0),
    };


    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 1000) / 10;
    };

    const prevHighRiskCount = await this.prisma.warning_cases.count({
      where: {
        org_id: orgId,
        is_active: true,
        status: { not: 'resolved' },
        created_at: {
          gte: twelveMonthsAgo,
          lt: sixMonthsAgo,
        },
      },
    });

    const totalGrowth = calculateGrowth(allWarnings, prevAllWarnings);
    const redGrowth = calculateGrowth(redWarnings, prevRedWarnings);
    const yellowGrowth = calculateGrowth(yellowWarnings, prevYellowWarnings);
    const resolvedGrowth = calculateGrowth(resolvedWarnings, prevResolvedWarnings);
    const pendingGrowth = calculateGrowth(pendingWarnings, prevPendingWarnings);
    const highRiskGrowth = calculateGrowth(activeHighRiskCount, prevHighRiskCount);

    return {
      code: 0,
      message: 'ok',
      data: {
        overview: {
          totalWarnings: allWarnings,
          redWarnings,
          yellowWarnings,
          resolvedWarnings,
          pendingWarnings,
          highRiskCount: activeHighRiskCount,
          totalGrowth,
          redGrowth,
          yellowGrowth,
          resolvedGrowth,
          pendingGrowth,
          highRiskGrowth,
        },
        trend: {
          labels,
          totals: labels.map(m => trendDataMap.get(m)?.total || 0),
          reds: labels.map(m => trendDataMap.get(m)?.red || 0),
          yellows: labels.map(m => trendDataMap.get(m)?.yellow || 0),
          resolveds: labels.map(m => trendDataMap.get(m)?.resolved || 0),
        },
        students: studentsList,
        classDistribution: classData,
      },
      trace_id: req.trace_id,
    };
  }
}
