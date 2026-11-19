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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { ImportService } from '../shared/import.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';

@Controller('admin/courses')
@UseGuards(AuthGuard, PermissionGuard)
export class CoursesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly importService: ImportService,
  ) {
    this.logger.setContext('CoursesController');
  }

  /**
   * 批量导入课程（P1-9 修复）
   *
   * 修复前：前端 `CourseManage.vue:234` 会 POST 本路径，
   * 但后端**从未实现该端点** → 用户点"导入"必然 404。
   *
   * 支持 xlsx / csv，支持 dryRun 预演，按表头名匹配列，
   * 外键（学院）查不到即进失败报告，**不自动创建主数据**。
   */
  @Post('import')
  @Permissions('course:create')
  @UseInterceptors(FileInterceptor('file'))
  async importCourses(
    @UploadedFile() file: any,
    @Body() body: any,
    @Query() query: any,
    @Req() req: any,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('请上传文件（字段名应为 file）');
    }

    // ----------------------------------------------------------------
    // 开关来源：body 与 query 都要读。
    //
    // 实测缺陷：原先只读 `body?.dryRun`，而调用方（以及 curl/脚本）
    // 习惯把开关放在 **query string** 上 —— 于是
    //   POST /admin/courses/import?dryRun=true
    // 会得到 dryRun=false，**预演直接把数据写进库**。
    // 这比"不支持 dryRun"更危险：调用方以为自己只是在预检。
    // 现在同时接受 body（multipart 表单字段）与 query 两种传法。
    // ----------------------------------------------------------------
    const pickFlag = (...values: any[]): string =>
      String(values.find((v) => v !== undefined && v !== null && v !== '') ?? '').trim();

    const dryRun = pickFlag(body?.dryRun, body?.dry_run, query?.dryRun, query?.dry_run) === 'true';
    const onDuplicate = (pickFlag(
      body?.onDuplicate,
      body?.on_duplicate,
      query?.onDuplicate,
      query?.on_duplicate,
    ) || 'skip') as any;

    if (!['skip', 'update', 'fail'].includes(onDuplicate)) {
      throw new BadRequestException(
        `onDuplicate 只支持 skip / update / fail，收到：${onDuplicate}`,
      );
    }

    const result = await this.importService.importBuffer({
      bizType: 'courses',
      filename: file.originalname || 'upload.xlsx',
      buffer: file.buffer,
      dryRun,
      onDuplicate,
    });
    return {
      code: 0,
      message: result.dryRun
        ? `预演完成（未写入数据库）：可导入 ${result.success} 行，失败 ${result.failed} 行`
        : result.failed > 0
          ? `导入完成，${result.failed} 行失败`
          : '导入成功',
      data: result,
      trace_id: req.trace_id,
    };
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
