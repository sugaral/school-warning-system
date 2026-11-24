import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';

class CreateClassDto {
  org_id!: string;
  class_name!: string;
  enroll_year!: number;
  major?: string;
  grade_level?: string;
  counselor_user_id?: string;
  status?: string;
}

class UpdateClassDto {
  org_id?: string;
  class_name?: string;
  enroll_year?: number;
  major?: string;
  grade_level?: string;
  counselor_user_id?: string;
  status?: string;
}

@Controller('admin/classes')
@UseGuards(AuthGuard, PermissionGuard)
export class ClassesAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ClassesAdminController');
  }

  private async syncHeadTeacherBinding(
    classId: bigint,
    orgId: bigint,
    nextCounselorUserId: bigint | null,
    previousCounselorUserId?: bigint | null,
  ) {
    if (
      previousCounselorUserId &&
      (!nextCounselorUserId ||
        previousCounselorUserId.toString() !== nextCounselorUserId.toString())
    ) {
      const previousRole = await this.prisma.user_roles.findFirst({
        where: {
          user_id: previousCounselorUserId,
          role: 'head_teacher',
          scope_id: classId,
        },
      });
      if (previousRole) {
        await this.prisma.user_roles.delete({
          where: { id: previousRole.id },
        });
      }
    }

    if (!nextCounselorUserId) {
      return;
    }

    const existingRole = await this.prisma.user_roles.findFirst({
      where: {
        user_id: nextCounselorUserId,
        role: 'head_teacher',
        scope_id: classId,
      },
      orderBy: { created_at: 'asc' },
    });

    if (existingRole) {
      await this.prisma.user_roles.update({
        where: { id: existingRole.id },
        data: {
          scope_type: 'class',
          scope_id: classId,
        },
      });
    } else {
      await this.prisma.user_roles.create({
        data: {
          user_id: nextCounselorUserId,
          role: 'head_teacher',
          scope_type: 'class',
          scope_id: classId,
        },
      });
    }

    await this.prisma.users.update({
      where: { id: nextCounselorUserId },
      data: {
        org_id: orgId,
      },
    });
  }

  private async collectClassRelationCounts(classId: bigint) {
    const [
      studentCount,
      sessionCount,
      scheduleCount,
      courseClassCount,
      leaveCount,
      warningCount,
      warningCaseCount,
      teacherBindingCount,
      dailyRecordCount,
    ] = await Promise.all([
      this.prisma.student_profiles.count({ where: { class_id: classId } }),
      this.prisma.class_sessions.count({ where: { class_id: classId } }),
      this.prisma.schedules.count({ where: { class_id: classId } }),
      this.prisma.course_classes.count({ where: { class_id: classId } }),
      this.prisma.leave_requests.count({ where: { class_id: classId } }),
      this.prisma.warnings.count({ where: { class_id: classId } }),
      this.prisma.warning_cases.count({ where: { class_id: classId } }),
      this.prisma.teacher_course_bindings.count({ where: { class_id: classId } }),
      this.prisma.daily_records.count({ where: { class_id: classId } }),
    ]);

    return [
      { label: '名学生', count: studentCount },
      { label: '个课次', count: sessionCount },
      { label: '条课表', count: scheduleCount },
      { label: '条课程与开课班', count: courseClassCount },
      { label: '条请假记录', count: leaveCount },
      { label: '条预警记录', count: warningCount },
      { label: '条高风险干预记录', count: warningCaseCount },
      { label: '条教师绑定记录', count: teacherBindingCount },
      { label: '条日记录', count: dailyRecordCount },
    ].filter((item) => item.count > 0);
  }

  @Get()
  @Permissions('class:read')
  @DataScope({ entity: 'class', field: 'class_id' })
  async listClasses(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();
    
    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const where: any = {};
    
    // 应用数据范围过滤
    const dataScope = req?.dataScope;
    if (dataScope && dataScope.type !== 'all') {
      if (dataScope.type === 'class') {
        where.id = { in: dataScope.classIds ?? [] };
      } else if (dataScope.type === 'college') {
        where.org_id = { in: dataScope.collegeIds ?? [] };
      } else if (dataScope.type === 'self') {
        // self 但没有学生档案（如普通教师）时不能退化为“无过滤”
        where.id = { in: [] };
      }
    }
    
    if (keyword) {
      where.OR = [
        { class_name: { contains: keyword } },
        { major: { contains: keyword } },
      ];
    }

    const [classes, total] = await Promise.all([
      this.prisma.classes.findMany({
        where,
        skip,
        take,
        orderBy: { class_name: 'asc' },
      }),
      this.prisma.classes.count({ where }),
    ]);

    const counselorIds = Array.from(
      new Set(
        classes
          .map((item: any) => item.counselor_user_id)
          .filter((item: any): item is bigint => Boolean(item))
          .map((item: bigint) => item.toString()),
      ),
    ).map((item) => BigInt(item));

    const counselors = counselorIds.length
      ? await this.prisma.users.findMany({
          where: { id: { in: counselorIds } },
          select: { id: true, name: true },
        })
      : [];
    const counselorMap = new Map(
      counselors.map((item: any) => [item.id.toString(), item.name]),
    );

    // Batch: collect all class IDs and org IDs, then do 2 queries instead of 2*N
    const classIds = classes.map((c: any) => c.id);
    const orgIds = Array.from(
      new Set(classes.map((c: any) => c.org_id.toString())),
    ).map((id) => BigInt(id));

    const [studentCountRows, orgs] = await Promise.all([
      classIds.length > 0
        ? this.prisma.student_profiles.groupBy({
            by: ['class_id'],
            where: { class_id: { in: classIds } },
            _count: { _all: true },
          })
        : [],
      orgIds.length > 0
        ? this.prisma.orgs.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const studentCountMap = new Map(
      studentCountRows.map((row: any) => [
        row.class_id.toString(),
        row._count._all,
      ]),
    );
    const orgMap = new Map(
      orgs.map((org: any) => [org.id.toString(), org.name]),
    );

    const classesWithCount = classes.map((c: any) => ({
      id: c.id.toString(),
      org_id: c.org_id.toString(),
      org_name: orgMap.get(c.org_id.toString()) || '未知学院',
      class_name: c.class_name,
      enroll_year: c.enroll_year,
      major: c.major,
      grade_level: c.grade_level,
      student_count: studentCountMap.get(c.id.toString()) || 0,
      counselor_user_id: c.counselor_user_id?.toString(),
      teacher_name: c.counselor_user_id
        ? counselorMap.get(c.counselor_user_id.toString()) || ''
        : '',
      status: c.status,
      created_at: c.created_at,
    }));

    return {
      code: 0,
      message: 'ok',
      data: {
        list: classesWithCount,
        total,
        page: parseInt(page),
        pageSize: take,
      },
      trace_id: req.trace_id,
    };
  }

  @Get(':id')
  @Permissions('class:read')
  @DataScope({ entity: 'class', field: 'class_id' })
  async getClass(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const cls = await this.prisma.classes.findUnique({
      where: { id: BigInt(id) },
    });

    if (!cls) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    // 计算班级学生人数
    const studentCount = await this.prisma.student_profiles.count({
      where: { class_id: cls.id },
    });

    // 获取学院信息
    const org = await this.prisma.orgs.findUnique({
      where: { id: cls.org_id },
    });

    const counselor = cls.counselor_user_id
      ? await this.prisma.users.findUnique({
          where: { id: cls.counselor_user_id },
          select: { name: true },
        })
      : null;

    return {
      code: 0,
      message: 'ok',
      data: {
        id: cls.id.toString(),
        org_id: cls.org_id.toString(),
        org_name: org?.name || '未知学院',
        class_name: cls.class_name,
        enroll_year: cls.enroll_year,
        major: cls.major,
        grade_level: cls.grade_level,
        student_count: studentCount,
        counselor_user_id: cls.counselor_user_id?.toString(),
        teacher_name: counselor?.name || '',
        status: cls.status,
        created_at: cls.created_at,
      },
      trace_id: req.trace_id,
    };
  }

  @Post()
  @Permissions('class:create')
  async createClass(@Body() dto: CreateClassDto, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    if (!dto.org_id) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const cls = await this.prisma.classes.create({
      data: {
        org_id: BigInt(dto.org_id),
        class_name: dto.class_name,
        enroll_year: dto.enroll_year,
        major: dto.major,
        grade_level: dto.grade_level,
        counselor_user_id: dto.counselor_user_id ? BigInt(dto.counselor_user_id) : null,
        status: dto.status || 'active',
      },
    });

    await this.syncHeadTeacherBinding(
      cls.id,
      cls.org_id,
      cls.counselor_user_id || null,
      null,
    );

    return {
      code: 0,
      message: '创建成功',
      data: { id: cls.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Put(':id')
  @Permissions('class:update')
  @DataScope({ entity: 'class', field: 'class_id' })
  async updateClass(
    @Param('id') id: string,
    @Body() dto: UpdateClassDto,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    
    const cls = await this.prisma.classes.findUnique({
      where: { id: BigInt(id) },
    });

    if (!cls) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {};
    if (dto.org_id) updateData.org_id = BigInt(dto.org_id);
    if (dto.class_name) updateData.class_name = dto.class_name;
    if (dto.enroll_year) updateData.enroll_year = dto.enroll_year;
    if (dto.major) updateData.major = dto.major;
    if (dto.grade_level) updateData.grade_level = dto.grade_level;
    if (dto.counselor_user_id !== undefined)
      updateData.counselor_user_id = dto.counselor_user_id ? BigInt(dto.counselor_user_id) : null;
    if (dto.status) updateData.status = dto.status;

    const updatedClass = await this.prisma.classes.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    await this.syncHeadTeacherBinding(
      updatedClass.id,
      updatedClass.org_id,
      updatedClass.counselor_user_id || null,
      cls.counselor_user_id || null,
    );

    return {
      code: 0,
      message: '更新成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Delete(':id')
  @Permissions('class:delete')
  async deleteClass(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const cls = await this.prisma.classes.findUnique({
      where: { id: BigInt(id) },
    });

    if (!cls) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    try {
      const relatedCounts = await this.collectClassRelationCounts(cls.id);
      if (relatedCounts.length > 0) {
        const summary = relatedCounts
          .map((item) => `${item.count} ${item.label}`)
          .join('、');
        return {
          code: 400,
          message: `班级 ${cls.class_name} 仍有关联数据（${summary}），无法删除`,
          data: null,
          trace_id: req.trace_id,
        };
      }

      // 执行删除操作
      await this.prisma.classes.delete({
        where: { id: BigInt(id) },
      });

      return {
        code: 0,
        message: '删除成功',
        data: null,
        trace_id: req.trace_id,
      };
    } catch (error) {
      if ((error as any)?.code === 'P2003') {
        const relatedCounts = await this.collectClassRelationCounts(cls.id);
        const summary = relatedCounts.length
          ? relatedCounts.map((item) => `${item.count} ${item.label}`).join('、')
          : '仍存在未识别的关联数据';
        return {
          code: 400,
          message: `班级 ${cls.class_name} 仍有关联数据（${summary}），无法删除`,
          data: null,
          trace_id: req.trace_id,
        };
      }
      this.logger.error({ err: error }, '删除班级失败');
      return {
        code: 500,
        message: '删除失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }
}


