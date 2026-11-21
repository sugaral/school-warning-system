import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';
import { ClassMonitorSnapshotService } from './class-monitor-snapshot.service';
import { NotificationCenterService } from '../shared/notification-center.service';

class CreateNotificationDto {
  title!: string;
  content!: string;
}

@Controller('class-monitor')
@UseGuards(AuthGuard, RolesGuard)
export class ClassMonitorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classMonitorSnapshotService: ClassMonitorSnapshotService,
    private readonly notificationCenter: NotificationCenterService,
  ) {}

  @Get('stats')
  @Roles('class_monitor')
  async getStats(@Req() req: any) {
    const userId = BigInt(req.user.sub);
    const classId = await this.getClassIdForMonitor(userId);

    if (!classId) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const snapshot = await this.classMonitorSnapshotService.getOrRefreshClassSnapshot(classId);

    return {
      code: 0,
      message: 'ok',
      data: {
        totalStudents: Number(snapshot?.total_students || 0),
        warningCount: Number(snapshot?.warning_count || 0),
        redWarning: Number(snapshot?.red_warning_count || 0),
        leaveCount: Number(snapshot?.leave_count || 0),
      },
      trace_id: req.trace_id,
    };
  }

  @Get('warnings')
  @Roles('class_monitor')
  async getWarnings(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Req() req: any,
  ) {
    const userId = BigInt(req.user.sub);
    const classId = await this.getClassIdForMonitor(userId);

    if (!classId) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const safePage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const take = Math.min(100, Math.max(1, parseInt(String(pageSize || '20'), 10) || 20));
    const skip = (safePage - 1) * take;

    const studentIds = (
      await this.prisma.student_profiles.findMany({
        where: { class_id: classId },
        select: { id: true },
      })
    ).map((s: { id: bigint }) => s.id);

    const [warnings, total] = await Promise.all([
      (this.prisma as any).warning_current_states.findMany({
        where: {
          student_id: { in: studentIds },
        },
        orderBy: { updated_at: 'desc' },
        skip,
        take,
      }),
      (this.prisma as any).warning_current_states.count({
        where: {
          student_id: { in: studentIds },
        },
      }),
    ]);

    const studentProfiles = await this.prisma.student_profiles.findMany({
      where: {
        id: { in: warnings.map((w: { student_id: bigint }) => w.student_id) },
      },
      include: {
        users: true,
      },
    });

    const studentMap = new Map(
      studentProfiles.map((sp: { id: bigint; student_no: string; users: { name: string } | null }) => [sp.id.toString(), sp]),
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        list: warnings.map((w: any) => {
          const sp = studentMap.get(w.student_id.toString()) as { student_no: string; users: { name: string } | null } | undefined;
          const detail = (w.trigger_detail_json as any) || {};
          return {
            id: w.id.toString(),
            student_id: w.student_id.toString(),
            student_no: sp?.student_no,
            name: sp?.users?.name,
            warning_level: w.level,
            course_name: detail.course_name || '',
            warning_reason: w.trigger_summary,
            status: w.status,
            created_at: w.created_at,
          };
        }),
        total,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('members')
  @Roles('class_monitor')
  async getMembers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Req() req: any,
  ) {
    const userId = BigInt(req.user.sub);
    const classId = await this.getClassIdForMonitor(userId);

    if (!classId) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const safePage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const take = Math.min(100, Math.max(1, parseInt(String(pageSize || '20'), 10) || 20));
    const skip = (safePage - 1) * take;

    const [members, total] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where: {
          class_id: classId,
        },
        include: {
          users: true,
        },
        orderBy: { student_no: 'asc' },
        skip,
        take,
      }),
      this.prisma.student_profiles.count({
        where: {
          class_id: classId,
        },
      }),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: members.map((m: { id: bigint; student_no: string; users: { name: string } | null; gender: string | null; mobile: string | null; student_position: string | null; status: string }) => ({
          id: m.id.toString(),
          student_no: m.student_no,
          name: m.users?.name,
          gender: m.gender,
          mobile: m.mobile,
          student_position: m.student_position,
          status: m.status,
        })),
        total,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('notifications')
  @Roles('class_monitor')
  async createNotification(@Body() dto: CreateNotificationDto, @Req() req: any) {
    const userId = BigInt(req.user.sub);
    const classId = await this.getClassIdForMonitor(userId);

    if (!classId) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    const classInfo = await this.prisma.classes.findUnique({
      where: { id: classId },
    });

    const notification = await this.prisma.class_notifications.create({
      data: {
        class_id: classId,
        org_id: classInfo?.org_id || BigInt(0),
        title: dto.title,
        content: dto.content,
        publisher_id: userId,
        publisher_name: user?.name || '未知',
      },
    });

    // ----------------------------------------------------------------
    // 站内消息扇出（复活僵尸表 `notification`）
    //
    // 班级公告原本只写 class_notifications 一行，学生要**主动打开公告页**
    // 才能看到 —— 没有任何"未读提醒"能力。这里给班内每个学生写一条
    // 个人站内消息，学生端即可通过未读数感知新公告。
    //
    // 失败不影响公告发布（createManyForUsers 内部吞异常只记日志）。
    // ----------------------------------------------------------------
    try {
      const classmates = await this.prisma.student_profiles.findMany({
        where: { class_id: classId },
        select: { user_id: true },
      });
      const userIds = classmates
        .map((item) => item.user_id)
        .filter((id): id is bigint => id !== null && id !== undefined);

      if (userIds.length > 0) {
        await this.notificationCenter.createManyForUsers(
          userIds,
          'class_notice',
          `【班级通知】${dto.title}\n${dto.content}`,
        );
      }
    } catch (fanoutError: any) {
      // 只记日志：公告本身已经发布成功，站内消息是增强而非必需
      // （createManyForUsers 已自行兜底，这里再包一层防御意外异常）
      console.warn(
        `[班级公告] 站内消息扇出失败 class=${classId.toString()}: ${fanoutError?.message || fanoutError}`,
      );
    }

    return {
      code: 0,
      message: '发布成功',
      data: {
        id: notification.id.toString(),
      },
      trace_id: req.trace_id,
    };
  }

  @Get('notifications')
  @Roles('class_monitor')
  async getNotifications(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Req() req: any,
  ) {
    const userId = BigInt(req.user.sub);
    const classId = await this.getClassIdForMonitor(userId);

    if (!classId) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const safePage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const take = Math.min(100, Math.max(1, parseInt(String(pageSize || '20'), 10) || 20));
    const skip = (safePage - 1) * take;

    const [notifications, total] = await Promise.all([
      this.prisma.class_notifications.findMany({
        where: {
          class_id: classId,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.class_notifications.count({
        where: {
          class_id: classId,
        },
      }),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: notifications.map((n: { id: bigint; title: string; content: string; publisher_name: string; created_at: Date }) => ({
          id: n.id.toString(),
          title: n.title,
          content: n.content,
          publisher_name: n.publisher_name,
          created_at: n.created_at,
        })),
        total,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('activities')
  @Roles('class_monitor')
  async getActivities(@Req() req: any) {
    const userId = BigInt(req.user.sub);
    const classId = await this.getClassIdForMonitor(userId);

    if (!classId) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const studentIds = (
      await this.prisma.student_profiles.findMany({
        where: { class_id: classId },
        select: { id: true },
      })
    ).map((s: { id: bigint }) => s.id);

    const activities: { type: string; title: string; created_at: Date; color: string }[] = [];

    const warnings = await (this.prisma as any).warning_current_states.findMany({
      where: { student_id: { in: studentIds } },
      orderBy: { updated_at: 'desc' },
      take: 10,
    });

    const warningStudentProfiles = await this.prisma.student_profiles.findMany({
      where: { id: { in: warnings.map((w: { student_id: bigint }) => w.student_id) } },
      include: { users: true },
    });

    const warningStudentMap = new Map(
      warningStudentProfiles.map((sp: { id: bigint; users: { name: string } | null }) => [sp.id.toString(), sp]),
    );

    warnings.forEach((w: { student_id: bigint; level: string; created_at: Date }) => {
      const sp = warningStudentMap.get(w.student_id.toString()) as { users: { name: string } | null } | undefined;
      activities.push({
        type: 'warning',
        title: `${sp?.users?.name || '学生'} 收到${w.level === 'red' ? '红色' : w.level === 'orange' ? '橙色' : '黄色'}预警`,
        created_at: w.created_at,
        color: w.level === 'red' ? '#dc2626' : w.level === 'orange' ? '#f97316' : '#d4a017',
      });
    });

    const notifications = await this.prisma.class_notifications.findMany({
      where: { class_id: classId },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    notifications.forEach((n: { title: string; created_at: Date }) => {
      activities.push({
        type: 'notification',
        title: `发布通知: ${n.title}`,
        created_at: n.created_at,
        color: '#67c23a',
      });
    });

    const leaves = await this.prisma.leave_requests.findMany({
      where: { student_id: { in: studentIds } },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    const leaveStudentProfiles = await this.prisma.student_profiles.findMany({
      where: { id: { in: leaves.map((l: { student_id: bigint }) => l.student_id) } },
      include: { users: true },
    });

    const leaveStudentMap = new Map(
      leaveStudentProfiles.map((sp: { id: bigint; users: { name: string } | null }) => [sp.id.toString(), sp]),
    );

    leaves.forEach((l: { student_id: bigint; created_at: Date }) => {
      const sp = leaveStudentMap.get(l.student_id.toString()) as { users: { name: string } | null } | undefined;
      activities.push({
        type: 'leave',
        title: `${sp?.users?.name || '学生'} 提交请假申请`,
        created_at: l.created_at,
        color: '#909399',
      });
    });

    activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      code: 0,
      message: 'ok',
      data: activities.slice(0, 10),
      trace_id: req.trace_id,
    };
  }

  private async getClassIdForMonitor(userId: bigint): Promise<bigint | null> {
    const userRole = await this.prisma.user_roles.findFirst({
      where: { user_id: userId, role: 'class_monitor' },
    });
    if (userRole?.scope_id) return userRole.scope_id;

    const studentProfile = await this.prisma.student_profiles.findFirst({
      where: { user_id: userId },
    });
    return studentProfile?.class_id ?? null;
  }
}

