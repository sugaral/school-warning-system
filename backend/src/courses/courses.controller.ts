import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';

@Controller('admin/courses')
@UseGuards(AuthGuard, PermissionGuard)
export class CoursesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('CoursesController');
  }

  private async collectCourseRelationCounts(courseId: bigint) {
    const [
      sessionCount,
      scheduleCount,
      courseClassCount,
      gradeCount,
      teacherBindingCount,
      dailyRecordCount,
      makeupRequestCount,
    ] = await Promise.all([
      this.prisma.class_sessions.count({ where: { course_id: courseId } }),
      this.prisma.schedules.count({ where: { course_id: courseId } }),
      this.prisma.course_classes.count({ where: { course_id: courseId } }),
      this.prisma.grades.count({ where: { course_id: courseId } }),
      this.prisma.teacher_course_bindings.count({ where: { course_id: courseId } }),
      this.prisma.daily_records.count({ where: { course_id: courseId } }),
      this.prisma.makeup_requests.count({ where: { course_id: courseId } }),
    ]);

    return [
      { label: '个课次', count: sessionCount },
      { label: '条课表', count: scheduleCount },
      { label: '条课程与开课班', count: courseClassCount },
      { label: '条成绩记录', count: gradeCount },
      { label: '条教师绑定记录', count: teacherBindingCount },
      { label: '条日记录', count: dailyRecordCount },
      { label: '条补课申请', count: makeupRequestCount },
    ].filter((item) => item.count > 0);
  }

  @Get()
  @Permissions('course:read')
  async listCourses() {
    await this.prisma.ensureConnected();
    
    const courses = await this.prisma.courses.findMany({
      include: {
        orgs: {
          select: { name: true }
        }
      },
      orderBy: { id: 'desc' }
    });

    return {
      code: 0,
      message: 'ok',
      data: courses.map((c: any) => ({
        id: c.id.toString(),
        course_code: c.course_code,
        course_name: c.course_name,
        credit: c.credit,
        org_id: c.org_id.toString(),
        org_name: c.orgs?.name || '',
        status: c.status
      }))
    };
  }

  @Post()
  @Permissions('course:create')
  async createCourse(@Body() dto: any) {
    await this.prisma.ensureConnected();
    
    const course = await this.prisma.courses.create({
      data: {
        org_id: BigInt(dto.org_id),
        course_code: dto.course_code,
        course_name: dto.course_name,
        credit: dto.credit,
        status: dto.status || 'active'
      }
    });

    return {
      code: 0,
      message: '创建成功',
      data: { id: course.id.toString() }
    };
  }

  @Put(':id')
  @Permissions('course:update')
  async updateCourse(@Param('id') id: string, @Body() dto: any) {
    await this.prisma.ensureConnected();
    
    await this.prisma.courses.update({
      where: { id: BigInt(id) },
      data: {
        org_id: BigInt(dto.org_id),
        course_code: dto.course_code,
        course_name: dto.course_name,
        credit: dto.credit,
        ...(dto.status !== undefined ? { status: dto.status } : {})
      }
    });

    return {
      code: 0,
      message: '更新成功'
    };
  }

  @Delete(':id')
  @Permissions('course:delete')
  async deleteCourse(@Param('id') id: string, @Req() req?: any) {
    await this.prisma.ensureConnected();

    const courseId = BigInt(id);
    const course = await this.prisma.courses.findUnique({
      where: { id: courseId }
    });

    if (!course) {
      return {
        code: 404,
        message: '课程不存在',
        data: null,
        trace_id: req?.trace_id,
      };
    }

    try {
      const relatedCounts = await this.collectCourseRelationCounts(courseId);
      await this.prisma.$transaction(async (tx) => {
        await tx.schedules.deleteMany({ where: { course_id: courseId } });
        await tx.course_classes.deleteMany({ where: { course_id: courseId } });
        await tx.teacher_course_bindings.deleteMany({ where: { course_id: courseId } });
        await tx.grades.deleteMany({ where: { course_id: courseId } });
        await tx.daily_records.deleteMany({ where: { course_id: courseId } });
        await tx.makeup_requests.deleteMany({ where: { course_id: courseId } });
        await tx.class_sessions.deleteMany({ where: { course_id: courseId } });
        await tx.courses.delete({
          where: { id: courseId }
        });
      });

      return {
        code: 0,
        message: relatedCounts.length > 0
          ? `删除成功，并清理了关联数据（${relatedCounts.map((item) => `${item.count} ${item.label}`).join('、')}）`
          : '删除成功',
        data: {
          deleted_relations: relatedCounts,
        },
        trace_id: req?.trace_id,
      };
    } catch (error) {
      if ((error as any)?.code === 'P2003') {
        const relatedCounts = await this.collectCourseRelationCounts(courseId);
        const summary = relatedCounts.length
          ? relatedCounts.map((item) => `${item.count} ${item.label}`).join('、')
          : '仍存在未识别的关联数据';
        return {
          code: 400,
          message: `课程 ${course.course_code || ''} ${course.course_name} 仍有关联数据（${summary}），无法删除`,
          data: null,
          trace_id: req?.trace_id,
        };
      }

      this.logger.error({ err: error }, '删除课程失败');
      return {
        code: 500,
        message: '删除失败',
        data: null,
        trace_id: req?.trace_id,
      };
    }
  }
}
