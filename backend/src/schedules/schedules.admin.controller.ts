import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';
import * as crypto from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  getTemplateRequiredFields,
  getTemplateValue,
  loadImportTemplate,
} from '../shared/import-template.util';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const SCHEDULE_TZ = 'Asia/Shanghai';

@Controller('admin/schedules')
@UseGuards(AuthGuard, PermissionGuard)
export class SchedulesAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('SchedulesAdminController');
  }

  private readonly scheduleImportPreviewLimit = 30;

  private normalizeTermCode(value?: string | null) {
    return String(value || '').trim().toUpperCase();
  }

  private getDerivedTermCode(dateValue?: Date | string | null) {
    if (!dateValue) {
      return '';
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (month >= 2 && month <= 7) {
      return `${year}-SPRING`;
    }
    if (month >= 8) {
      return `${year}-FALL`;
    }
    return `${year - 1}-FALL`;
  }

  private async findOrgByName(orgName: string) {
    if (!orgName) {
      return null;
    }

    return this.prisma.orgs.findFirst({
      where: {
        name: orgName,
      },
    });
  }

  private async findCourseForImport(courseCode: string, courseName: string, orgId?: bigint | null) {
    if (courseCode) {
      const courses = await this.prisma.courses.findMany({
        where: {
          course_code: courseCode,
          ...(orgId ? { org_id: orgId } : {}),
        },
        orderBy: { id: 'desc' },
        take: orgId ? 1 : 2,
      });
      if (courses.length > 1) {
        throw new Error(`课程代码 ${courseCode} 存在多条记录，请补充学院列后再导入课表`);
      }
      if (courses[0]) {
        return courses[0];
      }
    }

    if (courseName) {
      const courses = await this.prisma.courses.findMany({
        where: {
          course_name: courseName,
          ...(orgId ? { org_id: orgId } : {}),
        },
        take: 2,
      });

      if (courses.length > 1) {
        throw new Error(`课程名称 ${courseName} 存在重名，请在模板中启用课程代码列`);
      }

      if (courses[0]) {
        return courses[0];
      }
    }

    throw new Error(`未找到课程 ${courseCode || courseName || ''}`.trim());
  }

  private async findCourseForScheduleImport(input: {
    courseCode: string;
    courseName: string;
    orgId?: bigint | null;
    classId?: bigint | null;
    termCode: string;
    teacherName?: string;
  }) {
    const normalizedCourseCode = String(input.courseCode || '').trim().toUpperCase();
    const normalizedCourseName = String(input.courseName || '').trim();
    const normalizedTeacherName = String(input.teacherName || '').trim();
    const normalizedTermCode = this.normalizeTermCode(input.termCode);

    if (input.classId) {
      const bindings = await this.prisma.course_classes.findMany({
        where: {
          class_id: input.classId,
        },
        include: {
          courses: true,
          users: true,
        },
        orderBy: { id: 'desc' },
      });

      let matchedBindings = bindings.filter(
        (item: any) => this.normalizeTermCode(item.term_code) === normalizedTermCode,
      );

      if (normalizedCourseCode) {
        matchedBindings = matchedBindings.filter(
          (item: any) =>
            String(item.courses?.course_code || '').trim().toUpperCase() === normalizedCourseCode,
        );
      } else if (normalizedCourseName) {
        matchedBindings = matchedBindings.filter(
          (item: any) => String(item.courses?.course_name || '').trim() === normalizedCourseName,
        );
      }

      if (normalizedTeacherName) {
        const teacherMatchedBindings = matchedBindings.filter(
          (item: any) => String(item.users?.name || '').trim() === normalizedTeacherName,
        );
        if (teacherMatchedBindings.length === 1) {
          return teacherMatchedBindings[0].courses;
        }
        if (teacherMatchedBindings.length > 1) {
          matchedBindings = teacherMatchedBindings;
        }
      }

      if (matchedBindings.length === 1) {
        return matchedBindings[0].courses;
      }

      if (matchedBindings.length > 1) {
        throw new Error(`课程代码 ${input.courseCode || input.courseName} 在该班级学期下匹配到多条开课班记录，请补充教师名称后再导入`);
      }
    }

    return this.findCourseForImport(input.courseCode, input.courseName, input.orgId);
  }

  private async findClassForImport(className: string, orgId?: bigint | null) {
    const classes = await this.prisma.classes.findMany({
      where: {
        class_name: className,
        ...(orgId ? { org_id: orgId } : {}),
      },
      take: 2,
    });

    if (classes.length > 1) {
      throw new Error(`班级名称 ${className} 存在重名，请补充学院列后再导入`);
    }

    return classes[0] || null;
  }

  private async findTeacherForImport(teacherName: string) {
    const teachers = await this.prisma.users.findMany({
      where: {
        name: teacherName,
        user_type: 'teacher',
      },
      take: 2,
    });

    if (teachers.length > 1) {
      throw new Error(`教师姓名 ${teacherName} 存在重名，请先整理教师数据`);
    }

    return teachers[0] || null;
  }

  private isValidDateValue(value: Date | string | null | undefined) {
    if (!value) {
      return false;
    }

    const date = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(date.getTime());
  }

  private assertValidDate(value: Date | string | null | undefined, fieldLabel: string) {
    const date = value instanceof Date ? value : new Date(value as any);
    if (!this.isValidDateValue(date)) {
      throw new Error(`${fieldLabel}格式错误，请使用 YYYY/MM/DD HH:mm`);
    }
    return date;
  }

  private toIsoOrThrow(value: Date | string | null | undefined, fieldLabel: string) {
    return this.assertValidDate(value, fieldLabel).toISOString();
  }

  private formatScheduleDisplayTime(value: Date | string | null | undefined) {
    if (!this.isValidDateValue(value)) {
      return '无效时间';
    }
    return new Date(value as any).toLocaleString('zh-CN');
  }

  private parseScheduleDate(value: string, fieldLabel: string) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    if (!raw) {
      throw new Error(`${fieldLabel}不能为空`);
    }

    const normalized = raw
      .replace(/：/g, ':')
      .replace(/年/g, '/')
      .replace(/月/g, '/')
      .replace(/日/g, ' ')
      .replace(/T/g, ' ')
      .trim();

    const supportedFormats = [
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD HH:mm',
      'YYYY-MM-DD H:mm:ss',
      'YYYY-MM-DD H:mm',
      'YYYY/M/D HH:mm:ss',
      'YYYY/M/D HH:mm',
      'YYYY/M/D H:mm:ss',
      'YYYY/M/D H:mm',
      'YYYY/MM/DD HH:mm:ss',
      'YYYY/MM/DD HH:mm',
      'YYYY/MM/DD H:mm:ss',
      'YYYY/MM/DD H:mm',
      'YYYY-M-D HH:mm:ss',
      'YYYY-M-D HH:mm',
      'YYYY-M-D H:mm:ss',
      'YYYY-M-D H:mm',
    ];

    for (const format of supportedFormats) {
      try {
        const parsedByTimezone = dayjs.tz(normalized, format, SCHEDULE_TZ);
        if (parsedByTimezone.isValid()) {
          return this.assertValidDate(parsedByTimezone.toDate(), fieldLabel);
        }
      } catch {
        continue;
      }
    }

    const excelSerial = Number(normalized);
    if (
      Number.isFinite(excelSerial) &&
      excelSerial > 20000 &&
      excelSerial < 3000000
    ) {
      const utcDays = Math.floor(excelSerial - 25569);
      const fractionalDay = excelSerial - Math.floor(excelSerial);
      const totalSeconds = Math.round(fractionalDay * 24 * 60 * 60);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const base = new Date(Date.UTC(1970, 0, 1 + utcDays));
      const excelDate = new Date(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        hours,
        minutes,
        seconds,
        0,
      );
      return this.assertValidDate(excelDate, fieldLabel);
    }

    throw new Error(`${fieldLabel}格式错误，请使用 YYYY/MM/DD HH:mm`);
  }

  private buildScheduleImportKey(input: {
    termCode: string;
    courseId: bigint;
    classId: bigint;
    sessionStart: Date;
    sessionEnd: Date;
  }) {
    return [
      this.normalizeTermCode(input.termCode),
      input.courseId.toString(),
      input.classId.toString(),
      this.toIsoOrThrow(input.sessionStart, '上课开始时间'),
      this.toIsoOrThrow(input.sessionEnd, '下课时间'),
    ].join('|');
  }

  private toScheduleImportAuditRow(input: {
    rowNumber: number;
    termCode: string;
    courseCode: string;
    courseName: string;
    className: string;
    teacherName: string;
    sessionStart: Date;
    sessionEnd: Date;
    expireMinutes: number;
  }) {
    return {
      row: input.rowNumber,
      term_code: this.normalizeTermCode(input.termCode),
      course_code: input.courseCode,
      course_name: input.courseName,
      class_name: input.className,
      teacher_name: input.teacherName,
      session_start: this.toIsoOrThrow(input.sessionStart, '上课开始时间'),
      session_end: this.toIsoOrThrow(input.sessionEnd, '下课时间'),
      expire_minutes: input.expireMinutes,
    };
  }

  @Get()
  @Permissions('schedule:read')
  async listSchedules(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('class_id') classId?: string,
    @Query('class_ids') classIds?: string,
    @Query('term_code') termCode?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();
    
    const pageNum = parseInt(page);
    const pageSizeNum = parseInt(pageSize);
    const skip = (pageNum - 1) * pageSizeNum;

    if ((!classId && !classIds) || !String(termCode || '').trim()) {
      return {
        code: 0,
        message: 'ok',
        data: {
          list: [],
          total: 0,
          page: pageNum,
          pageSize: pageSizeNum,
        },
        trace_id: req.trace_id,
      };
    }
    
    const where: any = {};
    
    if (classId) {
      where.class_id = BigInt(classId);
    } else if (classIds) {
      // 支持多个班级 ID 查询
      const ids = classIds.split(',').map(id => BigInt(id.trim()));
      where.class_id = { in: ids };
    }
    
    const normalizedTermCode = this.normalizeTermCode(termCode);
    
    const schedules = await this.prisma.schedules.findMany({
      where,
      include: {
        courses: true,
        classes: {
          include: {
            orgs: true,
          },
        },
        users: true,
      },
      orderBy: {
        session_start: 'asc',
      },
    });

    const filteredSchedules = schedules
      .filter((item: any) => {
        const storedTermCode = this.normalizeTermCode(item.term_code);
        const derivedTermCode = this.getDerivedTermCode(item.session_start);
        return storedTermCode === normalizedTermCode || derivedTermCode === normalizedTermCode;
      })
      .sort((left: any, right: any) => {
        const startDiff =
          new Date(left.session_start).getTime() - new Date(right.session_start).getTime();
        if (startDiff !== 0) {
          return startDiff;
        }
        return new Date(left.session_end).getTime() - new Date(right.session_end).getTime();
      });
    const total = filteredSchedules.length;
    const pagedSchedules = filteredSchedules.slice(skip, skip + pageSizeNum);

    const updatedSchedules = pagedSchedules.map((s: any) => ({
      id: s.id.toString(),
      term_code: this.normalizeTermCode(s.term_code) || this.getDerivedTermCode(s.session_start),
      course_code: s.courses.course_code || '',
      course_name: s.courses.course_name,
      class_name: s.classes.class_name,
      org_name: s.classes.orgs?.name || '',
      teacher_name: s.users.name,
      session_start: s.session_start,
      session_end: s.session_end,
      expire_minutes: s.expire_minutes,
      status: s.status,
    }));
    
    return {
      code: 0,
      message: 'ok',
      data: {
        list: updatedSchedules,
        total,
        page: pageNum,
        pageSize: pageSizeNum,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('import')
  @Permissions('schedule:import')
  async importSchedules(@Body() schedules: any[], @Req() req: any) {
    await this.prisma.ensureConnected();

    const errors: string[] = [];
    const template = await loadImportTemplate(this.prisma, 'schedules');
    const requiredFields = getTemplateRequiredFields(template);
    const preparedRows: Array<{
      rowNumber: number;
      termCode: string;
      courseCode: string;
      courseName: string;
      className: string;
      teacherName: string;
      courseId: bigint;
      classId: bigint;
      teacherUserId: bigint;
      sessionStart: Date;
      sessionEnd: Date;
      expireMinutes: number;
    }> = [];

    for (let index = 0; index < schedules.length; index++) {
      const schedule = schedules[index] || {};
      try {
        for (const field of requiredFields) {
          if (field.key === 'course_code' || field.key === 'course_name') {
            continue;
          }
          if (!getTemplateValue(schedule, template, field.key)) {
            throw new Error(`${field.label}不能为空`);
          }
        }

        const orgName = getTemplateValue(schedule, template, 'org_name');
        const termCode = this.normalizeTermCode(
          getTemplateValue(schedule, template, 'term_code'),
        );
        const courseCode = String(
          getTemplateValue(schedule, template, 'course_code'),
        ).trim().toUpperCase();
        const courseName = String(
          getTemplateValue(schedule, template, 'course_name'),
        ).trim();
        const className = String(
          getTemplateValue(schedule, template, 'class_name'),
        ).trim();
        const teacherName = String(
          getTemplateValue(schedule, template, 'teacher_name'),
        ).trim();
        const sessionStartText = getTemplateValue(schedule, template, 'session_start');
        const sessionEndText = getTemplateValue(schedule, template, 'session_end');
        const expireMinutesText = getTemplateValue(schedule, template, 'expire_minutes');

        if (!courseCode && !courseName) {
          throw new Error('课程代码和课程名称至少填写一个');
        }

        const org = await this.findOrgByName(orgName);
        const orgId = org?.id || null;
        const clazz = await this.findClassForImport(className, orgId);

        if (!clazz) {
          throw new Error(`班级 ${className} 不存在，请先创建班级`);
        }

        const teacher = await this.findTeacherForImport(teacherName);
        if (!teacher) {
          throw new Error(`教师 ${teacherName} 不存在，请先创建教师`);
        }

        const course = await this.findCourseForScheduleImport({
          courseCode,
          courseName,
          orgId,
          classId: clazz.id,
          termCode,
          teacherName,
        });

        const sessionStart = this.parseScheduleDate(sessionStartText, '上课开始时间');
        const sessionEnd = this.parseScheduleDate(sessionEndText, '下课时间');
        if (sessionEnd.getTime() <= sessionStart.getTime()) {
          throw new Error('下课时间必须晚于上课开始时间');
        }

        const expireMinutes = parseInt(expireMinutesText, 10);
        if (isNaN(expireMinutes) || expireMinutes <= 0) {
          throw new Error('过期分钟数必须为正数');
        }

        preparedRows.push({
          rowNumber: index + 1,
          termCode,
          courseCode,
          courseName: course.course_name,
          className: clazz.class_name,
          teacherName: teacher.name,
          courseId: course.id,
          classId: clazz.id,
          teacherUserId: teacher.id,
          sessionStart,
          sessionEnd,
          expireMinutes,
        });
      } catch (error: any) {
        this.logger.error({ err: error, row: index + 1 }, '导入课表失败');
        errors.push(`第${index + 1}行: ${error?.message || '导入失败'}`);
      }
    }

    const actorUserId = BigInt(req.user?.userId || req.user?.sub);
    const sortedRows = [...preparedRows].sort(
      (left, right) => left.sessionStart.getTime() - right.sessionStart.getTime(),
    );
    const rowsToInsert: typeof preparedRows = [];
    const insertedRowsPreview: ReturnType<typeof this.toScheduleImportAuditRow>[] = [];
    const skippedRowsPreview: Array<{
      row: number;
      reason: string;
      term_code: string;
      course_name: string;
      class_name: string;
      teacher_name: string;
      session_start: string;
    }> = [];
    const seenImportKeys = new Set<string>();

    for (const item of sortedRows) {
      const scheduleKey = this.buildScheduleImportKey(item);
      if (seenImportKeys.has(scheduleKey)) {
        const reason = `第${item.rowNumber}行: 导入文件内重复课表，已跳过`;
        errors.push(reason);
        skippedRowsPreview.push({
          row: item.rowNumber,
          reason: '导入文件内重复课表',
          term_code: item.termCode,
          course_name: item.courseName,
          class_name: item.className,
          teacher_name: item.teacherName,
          session_start: this.toIsoOrThrow(item.sessionStart, '上课开始时间'),
        });
        continue;
      }
      seenImportKeys.add(scheduleKey);

      const existingSchedules = await this.prisma.schedules.findMany({
        where: {
          course_id: item.courseId,
          class_id: item.classId,
          session_start: item.sessionStart,
          session_end: item.sessionEnd,
          status: 'active',
        },
        select: {
          id: true,
          term_code: true,
        },
      });

      const matchedExisting = existingSchedules.find(
        (existing) =>
          this.normalizeTermCode(existing.term_code) ===
          this.normalizeTermCode(item.termCode),
      );

      if (matchedExisting) {
        const reason = `第${item.rowNumber}行: 与现有课表重复，已跳过`;
        errors.push(
          `${reason}：${item.className} - ${item.termCode} - ${item.courseName} - ${this.formatScheduleDisplayTime(item.sessionStart)}`,
        );
        skippedRowsPreview.push({
          row: item.rowNumber,
          reason: '与现有课表重复',
          term_code: item.termCode,
          course_name: item.courseName,
          class_name: item.className,
          teacher_name: item.teacherName,
          session_start: this.toIsoOrThrow(item.sessionStart, '上课开始时间'),
        });
        continue;
      }

      rowsToInsert.push(item);
      if (insertedRowsPreview.length < this.scheduleImportPreviewLimit) {
        insertedRowsPreview.push(this.toScheduleImportAuditRow(item));
      }
    }

    if (rowsToInsert.length > 0) {
      await this.prisma.$transaction(
        rowsToInsert.map((item) =>
          this.prisma.schedules.create({
            data: {
              term_code: item.termCode,
              course_id: item.courseId,
              class_id: item.classId,
              teacher_user_id: item.teacherUserId,
              session_start: item.sessionStart,
              session_end: item.sessionEnd,
              expire_minutes: item.expireMinutes,
              status: 'active',
            },
          }),
        ),
      );
    }

    const success = rowsToInsert.length;
    const failed = schedules.length - success;
    const auditRowsPreview = sortedRows
      .sort((left, right) => left.sessionStart.getTime() - right.sessionStart.getTime())
      .slice(0, this.scheduleImportPreviewLimit)
      .map((item) => this.toScheduleImportAuditRow(item));

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action: 'schedule.import',
        entity_type: 'schedule',
        entity_id: 0n,
        after_json: {
          mode: success > 0 ? (failed > 0 ? 'partial_success' : 'success') : 'skipped',
          total: schedules.length,
          success,
          failed,
          prepared_count: preparedRows.length,
          rows_preview: auditRowsPreview,
          inserted_rows_preview: insertedRowsPreview,
          skipped_rows_preview: skippedRowsPreview.slice(0, this.scheduleImportPreviewLimit),
          errors,
        } as any,
        ip: req.ip || null,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : null,
      },
    });

    return {
      code: 0,
      message:
        failed > 0
          ? `导入完成：成功 ${success} 条，跳过 ${failed} 条`
          : '导入完成',
      data: { success, failed, errors },
      trace_id: req.trace_id,
    };
  }

  @Put(':id')
  @Permissions('schedule:read')
  async updateSchedule(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    
    try {
      const updateData: any = {
        updated_at: new Date(),
      };
      
      if (body.course_code) {
        const course = await this.prisma.courses.findFirst({
          where: { course_code: body.course_code },
        });
        if (!course) {
          return {
            code: 400,
            message: `课程代码 ${body.course_code} 不存在`,
            data: null,
            trace_id: req.trace_id,
          };
        }
        updateData.course_id = course.id;
      }
      
      if (body.class_name) {
        let clazz = await this.prisma.classes.findFirst({
          where: { class_name: body.class_name },
        });
        
        if (!clazz) {
          const gradeMatch = body.class_name.match(/(\d+)级/);
          const enrollYear = gradeMatch ? parseInt(gradeMatch[1]) : new Date().getFullYear();
          
          clazz = await this.prisma.classes.create({
            data: {
              class_name: body.class_name,
              org_id: 1,
              enroll_year: enrollYear,
            },
          });
        }
        updateData.class_id = clazz.id;
      }
      
      if (body.teacher_name) {
        let teacher = await this.prisma.users.findFirst({
          where: { name: body.teacher_name, user_type: 'teacher' },
        });
        
        if (!teacher) {
          teacher = await this.prisma.users.create({
            data: {
              name: body.teacher_name,
              user_type: 'teacher',
              status: 'active',
            },
          });
        }
        updateData.teacher_user_id = teacher.id;
      }
      
      if (body.session_start) {
        const sessionStart = new Date(body.session_start);
        if (isNaN(sessionStart.getTime())) {
          return {
            code: 400,
            message: '操作失败',
            data: null,
            trace_id: req.trace_id,
          };
        }
        updateData.session_start = sessionStart;
      }
      
      if (body.session_end) {
        const sessionEnd = new Date(body.session_end);
        if (isNaN(sessionEnd.getTime())) {
          return {
            code: 400,
            message: '下课时间格式错误',
            data: null,
            trace_id: req.trace_id,
          };
        }
        updateData.session_end = sessionEnd;
      }
      
      if (body.expire_minutes) {
        const expireMinutes = parseInt(body.expire_minutes);
        if (isNaN(expireMinutes) || expireMinutes <= 0) {
          return {
            code: 400,
            message: '过期分钟数必须为正数',
            data: null,
            trace_id: req.trace_id,
          };
        }
        updateData.expire_minutes = expireMinutes;
      }
      
      if (body.term_code) {
        updateData.term_code = body.term_code;
      }
      
      if (body.status) {
        updateData.status = body.status;
      }

      const updatedSchedule = await this.prisma.schedules.update({
        where: { id: BigInt(id) },
        data: updateData,
        include: {
          courses: true,
          classes: true,
          users: true,
        },
      });
      
      return {
        code: 0,
        message: '更新成功',
        data: {
          id: updatedSchedule.id.toString(),
          term_code: updatedSchedule.term_code,
          course_code: updatedSchedule.courses.course_code || '',
          course_name: updatedSchedule.courses.course_name,
          class_name: updatedSchedule.classes.class_name,
          teacher_name: updatedSchedule.users.name,
          session_start: updatedSchedule.session_start,
          session_end: updatedSchedule.session_end,
          expire_minutes: updatedSchedule.expire_minutes,
          status: updatedSchedule.status,
        },
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error({ err: error }, '更新课表失败');
      return {
        code: 500,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Get('import-template')
  @Permissions('schedule:read')
  async getImportTemplate(@Req() req: any) {
    await this.prisma.ensureConnected();

    const template = await loadImportTemplate(this.prisma, 'schedules');
    return {
      code: 0,
      message: 'ok',
      data: template,
      trace_id: req?.trace_id,
    };
  }

  @Delete(':id')
  @Permissions('schedule:delete')
  async deleteSchedule(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    
    try {
      await this.prisma.schedules.delete({
        where: { id: BigInt(id) },
      });
      
      return {
        code: 0,
        message: '删除成功',
        data: null,
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error({ err: error }, '删除课表失败');
      return {
        code: 500,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Post('batch-delete')
  @Permissions('schedule:delete')
  async batchDeleteSchedules(
    @Body()
    body: {
      org_name?: string;
      class_id?: string;
      term_code?: string;
    },
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();

    const classIdText = String(body.class_id || '').trim();
    const termCode = this.normalizeTermCode(body.term_code);
    const orgName = String(body.org_name || '').trim();

    if (!classIdText || !/^\d+$/.test(classIdText)) {
      return {
        code: 400,
        message: '请选择要删除的班级',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!termCode) {
      return {
        code: 400,
        message: '请选择要删除的学期',
        data: null,
        trace_id: req.trace_id,
      };
    }

    try {
      const classInfo = await this.prisma.classes.findUnique({
        where: { id: BigInt(classIdText) },
        include: {
          orgs: true,
        },
      });

      if (!classInfo) {
        return {
          code: 404,
          message: '班级不存在',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const classOrgName = String(classInfo.orgs?.name || '').trim();
      if (orgName && classOrgName && classOrgName !== orgName) {
        return {
          code: 400,
          message: '学院与班级不匹配',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const schedules = await this.prisma.schedules.findMany({
        where: {
          class_id: classInfo.id,
        },
        select: {
          id: true,
          term_code: true,
          session_start: true,
          course_id: true,
          teacher_user_id: true,
        },
        orderBy: {
          session_start: 'asc',
        },
      });

      const matchedIds = schedules
        .filter((item: any) => {
          const storedTermCode = this.normalizeTermCode(item.term_code);
          const derivedTermCode = this.getDerivedTermCode(item.session_start);
          return storedTermCode === termCode || derivedTermCode === termCode;
        })
        .map((item: any) => item.id);

      if (matchedIds.length === 0) {
        return {
          code: 404,
          message: '当前班级在所选学期下没有可删除的课表',
          data: {
            deleted_count: 0,
          },
          trace_id: req.trace_id,
        };
      }

      await this.prisma.schedules.deleteMany({
        where: {
          id: { in: matchedIds },
        },
      });

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: BigInt(req.user?.userId || req.user?.sub),
          action: 'schedule.batch-delete',
          entity_type: 'schedule',
          entity_id: 0n,
          before_json: {
            org_name: orgName || classOrgName,
            class_id: classInfo.id.toString(),
            class_name: classInfo.class_name,
            term_code: termCode,
            matched_schedule_ids: matchedIds.map((item: bigint) => item.toString()),
          } as any,
          after_json: {
            deleted_count: matchedIds.length,
          } as any,
          ip: req.ip || null,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : null,
        },
      });

      return {
        code: 0,
        message: `已删除 ${matchedIds.length} 条课表`,
        data: {
          deleted_count: matchedIds.length,
          class_id: classInfo.id.toString(),
          class_name: classInfo.class_name,
          org_name: classOrgName,
          term_code: termCode,
        },
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error({ err: error }, '批量删除课表失败');
      return {
        code: 500,
        message: '批量删除课表失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }
}

