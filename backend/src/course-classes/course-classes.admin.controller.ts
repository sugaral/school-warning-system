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
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';
import {
  getTemplateRequiredFields,
  getTemplateValue,
  loadImportTemplate,
} from '../shared/import-template.util';

@Controller('admin/course-classes')
@UseGuards(AuthGuard, PermissionGuard)
export class CourseClassesAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('CourseClassesAdminController');
  }

  private parseCourseCode(value: unknown) {
    const code = String(value || '').trim().toUpperCase();
    const match = code.match(/^([A-Z]+)(\d+)(.*)$/);

    if (!match) {
      return {
        prefix: code,
        number: Number.POSITIVE_INFINITY,
        suffix: '',
        raw: code,
      };
    }

    return {
      prefix: match[1],
      number: Number(match[2]),
      suffix: match[3] || '',
      raw: code,
    };
  }

  private compareCourseCode(left: unknown, right: unknown) {
    const leftParsed = this.parseCourseCode(left);
    const rightParsed = this.parseCourseCode(right);

    if (leftParsed.prefix !== rightParsed.prefix) {
      return leftParsed.prefix.localeCompare(rightParsed.prefix, 'zh-CN');
    }
    if (leftParsed.number !== rightParsed.number) {
      return leftParsed.number - rightParsed.number;
    }
    if (leftParsed.suffix !== rightParsed.suffix) {
      return leftParsed.suffix.localeCompare(rightParsed.suffix, 'zh-CN');
    }

    return leftParsed.raw.localeCompare(rightParsed.raw, 'zh-CN', { numeric: true });
  }

  private parseCredit(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

  private async findCourseForImport(input: {
    courseCode: string;
    courseName: string;
    orgId?: bigint | null;
    creditText?: string;
  }) {
    const { courseCode, courseName, orgId, creditText } = input;

    if (courseCode) {
      const course = await this.prisma.courses.findFirst({
        where: {
          course_code: courseCode,
          ...(orgId ? { org_id: orgId } : {}),
        },
      });
      if (course) {
        return course;
      }
    }

    if (courseName) {
      const matchedCourses = await this.prisma.courses.findMany({
        where: {
          course_name: courseName,
          ...(orgId ? { org_id: orgId } : {}),
        },
        take: 2,
      });

      if (matchedCourses.length > 1) {
        throw new Error(`课程名称 ${courseName} 存在重名，请在模板中启用课程代码列`);
      }

      if (matchedCourses[0]) {
        return matchedCourses[0];
      }
    }

    if (!courseCode) {
      throw new Error(`未找到课程 ${courseName}，且缺少课程代码，无法自动创建`);
    }

    if (!courseName) {
      throw new Error(`课程代码 ${courseCode} 不存在，且缺少课程名称，无法自动创建`);
    }

    const courseData: any = {
      course_code: courseCode,
      course_name: courseName,
      credit: this.parseCredit(String(creditText || '0')),
    };
    if (orgId) {
      courseData.org_id = orgId;
    }

    return this.prisma.courses.create({
      data: courseData,
    });
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

  @Get()
  @Permissions('course:read')
  @DataScope({ entity: 'course', field: 'course_id' })
  async listCourseClasses(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('class_id') classId?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();
    
    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const where: any = {};
    
    // 应用数据范围过滤
    const dataScope = req?.dataScope;
    if (dataScope && dataScope.type !== 'all') {
      if (dataScope.type === 'college' && dataScope.collegeIds) {
        where.courses = {
          org_id: { in: dataScope.collegeIds.map((id: bigint) => id) }
        };
      } else if (dataScope.type === 'class' && dataScope.classIds) {
        where.class_id = { in: dataScope.classIds.map((id: bigint) => id) };
      }
    }
    
    if (keyword) {
      where.OR = [
        { courses: { course_name: { contains: keyword } } },
        { classes: { class_name: { contains: keyword } } },
      ];
    }

    if (classId) {
      where.class_id = BigInt(classId);
    }

    try {
      const [courseClasses, total] = await Promise.all([
        this.prisma.course_classes.findMany({
          where,
          skip,
          take,
          orderBy: { id: 'asc' },
        }),
        this.prisma.course_classes.count({ where }),
      ]);

      const courseIds = [...new Set(courseClasses.map((cc: any) => cc.course_id))] as bigint[];
      const classIds = [...new Set(courseClasses.map((cc: any) => cc.class_id))] as bigint[];
      const teacherIds = [...new Set(courseClasses.map((cc: any) => cc.teacher_user_id))] as bigint[];

      const [courses, classes, users] = await Promise.all([
        courseIds.length > 0 ? this.prisma.courses.findMany({
          where: { id: { in: courseIds } },
        }) : [],
        classIds.length > 0 ? this.prisma.classes.findMany({
          where: { id: { in: classIds } },
        }) : [],
        teacherIds.length > 0 ? this.prisma.users.findMany({
          where: { id: { in: teacherIds } },
        }) : [],
      ]);

      const courseMap = new Map(courses.map((c: any) => [c.id, c]));
      const classMap = new Map(classes.map((c: any) => [c.id, c]));
      const userMap = new Map(users.map((u: any) => [u.id, u]));
      
      const list = courseClasses.map((cc: any) => {
        try {
          const course = courseMap.get(cc.course_id) as any;
          const cls = classMap.get(cc.class_id) as any;
          const user = userMap.get(cc.teacher_user_id) as any;
          
          return {
            id: cc.id.toString(),
            org_id: course?.org_id?.toString() || '',
            course_id: course?.id?.toString() || '',
            course_code: course?.course_code || '',
            course_name: course?.course_name || '',
            credit: course?.credit ? parseFloat(course.credit.toString()) : 0,
            class_id: cls?.id?.toString() || '',
            class_name: cls?.class_name || '',
            teacher_id: user?.id?.toString() || '',
            teacher_name: user?.name || '',
            term_code: cc.term_code || '',
            status: 'active',
            created_at: cc.created_at,
          };
        } catch (error) {
          this.logger.error({ err: error, data: cc }, '转换开课班数据失败');
          return null;
        }
      }).filter((item: any) => item !== null)
        .sort((left: any, right: any) => {
          const codeDiff = this.compareCourseCode(left?.course_code, right?.course_code);
          if (codeDiff !== 0) {
            return codeDiff;
          }

          const classDiff = String(left?.class_name || '').localeCompare(
            String(right?.class_name || ''),
            'zh-CN',
            { numeric: true },
          );
          if (classDiff !== 0) {
            return classDiff;
          }

          return String(left?.term_code || '').localeCompare(
            String(right?.term_code || ''),
            'zh-CN',
            { numeric: true },
          );
        });

      return {
        code: 0,
        message: 'ok',
        data: {
          list,
          total,
          page: parseInt(page),
          pageSize: take,
        },
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error({ err: error }, '查询开课班列表失败');
      return {
        code: 1,
        message: '查询失败: ' + (error as any).message,
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Post()
  @Permissions('course:create')
  async createCourseClass(@Body() dto: any, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    // 检查请求体
    if (dto.course_name) {
      const codes = dto.course_name.split('').map((c: string) => c.charCodeAt(0));
    }
    
    if (!dto.course_code) {
      return {
        code: 1,
        message: '课程代码不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    if (!dto.class_id) {
      return {
        code: 1,
        message: '班级不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    if (!dto.teacher_id) {
      return {
        code: 1,
        message: '教师不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    if (!dto.term_code) {
      return {
        code: 1,
        message: '学期代码不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    let courseId: bigint;
    
    if (dto.course_id) {
      courseId = BigInt(dto.course_id);
    } else {
      let course = await this.prisma.courses.findFirst({
        where: { course_code: dto.course_code },
      });
      
      if (!course) {
        // 课程不存在时自动创建课程
        if (!dto.course_name) {
          return {
            code: 1,
            message: `课程代码 ${dto.course_code} 不存在，且未提供课程名称`,
            data: null,
            trace_id: req.trace_id,
          };
        }
        
        const courseData: any = {
          course_code: dto.course_code,
          course_name: dto.course_name,
          credit: dto.credit ? parseFloat(dto.credit.toString()) : 0,
        };
        if (dto.org_id) {
          courseData.org_id = BigInt(dto.org_id);
        }
        course = await this.prisma.courses.create({
          data: courseData,
        });
      }
      
      courseId = course.id;
    }
    
    const courseClass = await this.prisma.course_classes.create({
      data: {
        course_id: courseId,
        class_id: BigInt(dto.class_id),
        teacher_user_id: BigInt(dto.teacher_id),
        term_code: dto.term_code,
      },
    });
    
    return {
      code: 0,
      message: '创建成功',
      data: { id: courseClass.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Post('import')
  @Permissions('course:create')
  async importCourseClasses(@Body() courseClasses: any[], @Req() req: any) {
    await this.prisma.ensureConnected();

    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    const template = await loadImportTemplate(this.prisma, 'course_classes');
    const requiredFields = getTemplateRequiredFields(template);

    for (let index = 0; index < courseClasses.length; index++) {
      const cc = courseClasses[index] || {};
      try {
        for (const field of requiredFields) {
          if (!getTemplateValue(cc, template, field.key)) {
            throw new Error(`${field.label}不能为空`);
          }
        }

        const orgName = getTemplateValue(cc, template, 'org_name');
        const courseCode = getTemplateValue(cc, template, 'course_code');
        const courseName = getTemplateValue(cc, template, 'course_name');
        const creditText = getTemplateValue(cc, template, 'credit');
        const className = getTemplateValue(cc, template, 'class_name');
        const teacherName = getTemplateValue(cc, template, 'teacher_name');
        const termCode = getTemplateValue(cc, template, 'term_code');

        if (!courseCode && !courseName) {
          throw new Error('课程代码和课程名称至少填写一个');
        }

        const org = await this.findOrgByName(orgName);
        const orgId = org?.id || null;
        const course = await this.findCourseForImport({
          courseCode,
          courseName,
          orgId,
          creditText,
        });

        const clazz = await this.findClassForImport(className, orgId);
        if (!clazz) {
          throw new Error(`班级名称 ${className} 不存在`);
        }

        const teacher = await this.findTeacherForImport(teacherName);
        if (!teacher) {
          throw new Error(`教师姓名 ${teacherName} 不存在`);
        }

        const existing = await this.prisma.course_classes.findFirst({
          where: {
            course_id: course.id,
            class_id: clazz.id,
            term_code: termCode,
          },
        });

        if (existing) {
          throw new Error(
            `开课班已存在：课程=${course.course_name || course.course_code}，班级=${clazz.class_name}，学期=${termCode}，记录ID=${existing.id.toString()}`,
          );
        }

        await this.prisma.course_classes.create({
          data: {
            course_id: course.id,
            class_id: clazz.id,
            teacher_user_id: teacher.id,
            term_code: termCode,
          },
        });
        success++;
      } catch (error: any) {
        this.logger.error({ err: error }, '导入开课班失败');
        failed++;
        errors.push(`第${index + 1}行: ${error?.message || '导入失败'}`);
      }
    }

    return {
      code: 0,
      message: '导入完成',
      data: { success, failed, errors },
      trace_id: req.trace_id,
    };
  }

  @Put(':id')
  @Permissions('course:update')
  @DataScope({ entity: 'course', field: 'course_id' })
  async updateCourseClass(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    if (!dto.course_code) {
      return {
        code: 1,
        message: '课程代码不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    if (!dto.class_id) {
      return {
        code: 1,
        message: '班级不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    if (!dto.teacher_id) {
      return {
        code: 1,
        message: '教师不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    if (!dto.term_code) {
      return {
        code: 1,
        message: '学期代码不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }
    
    let courseId: bigint;
    
    if (dto.course_id) {
      courseId = BigInt(dto.course_id);
    } else {
      let course = await this.prisma.courses.findFirst({
        where: { course_code: dto.course_code },
      });
      
      if (!course) {
        // 课程不存在时自动创建课程
        if (!dto.course_name) {
          return {
            code: 1,
            message: `课程代码 ${dto.course_code} 不存在，且未提供课程名称`,
            data: null,
            trace_id: req.trace_id,
          };
        }
        
        const courseData: any = {
          course_code: dto.course_code,
          course_name: dto.course_name,
          credit: dto.credit ? parseFloat(dto.credit.toString()) : 0,
        };
        if (dto.org_id) {
          courseData.org_id = BigInt(dto.org_id);
        }
        course = await this.prisma.courses.create({
          data: courseData,
        });
      }
      
      courseId = course.id;

      if (dto.course_name || dto.credit !== undefined) {
        const updateData: any = {};
        if (dto.course_name) updateData.course_name = dto.course_name;
        if (dto.credit !== undefined) updateData.credit = parseFloat(dto.credit.toString());
        
        await this.prisma.courses.update({
          where: { id: courseId },
          data: updateData,
        });
      }
    }
    
    const courseClass = await this.prisma.course_classes.update({
      where: { id: BigInt(id) },
      data: {
        course_id: courseId,
        class_id: BigInt(dto.class_id),
        teacher_user_id: BigInt(dto.teacher_id),
        term_code: dto.term_code,
      },
    });

    return {
      code: 0,
      message: '更新成功',
      data: { id: courseClass.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Delete(':id')
  @Permissions('course:delete')
  @DataScope({ entity: 'course', field: 'course_id' })
  async deleteCourseClass(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    await this.prisma.course_classes.delete({
      where: { id: BigInt(id) },
    });

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }
}


