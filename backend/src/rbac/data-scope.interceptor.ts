import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { DATA_SCOPE_KEY, DataScopeOptions } from './permission.decorator';
import { PermissionService } from './permission.service';
import { normalizeRoleCode } from '../shared/role-catalog';

type DataScopeType = 'all' | 'college' | 'class' | 'self';

type RequestDataScope = {
  type: DataScopeType;
  collegeIds?: bigint[];
  classIds?: bigint[];
  studentIds?: bigint[];
  orgIds?: string[];
};

type ScopedResourceCheck = {
  entity: string;
  id: string;
};

@Injectable()
export class DataScopeInterceptor implements NestInterceptor {
  private readonly dataScopeCacheTtlSeconds = 30;
  private readonly localCache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly MAX_CACHE_SIZE = 5000;
  private lastSweepAt = 0;

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('DataScopeInterceptor');
  }

  private buildDataScopeCacheKey(userId: bigint) {
    return `rbac:data-scope:${userId.toString()}`;
  }

  private buildStudentIdCacheKey(userId: bigint) {
    return `rbac:student-id:${userId.toString()}`;
  }

  private async getCachedValue<T>(key: string): Promise<T | null> {
    const cached = this.localCache.get(key);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.localCache.delete(key);
      return null;
    }

    return cached.value as T;
  }

  private primeCache(key: string, value: unknown) {
    const now = Date.now();
    if (now - this.lastSweepAt > 60_000 || this.localCache.size >= DataScopeInterceptor.MAX_CACHE_SIZE) {
      this.lastSweepAt = now;
      for (const [k, entry] of this.localCache) {
        if (entry.expiresAt <= now) {
          this.localCache.delete(k);
        }
      }
      if (this.localCache.size >= DataScopeInterceptor.MAX_CACHE_SIZE) {
        const entries = [...this.localCache.entries()].sort(
          (a, b) => a[1].expiresAt - b[1].expiresAt,
        );
        const toEvict = entries.slice(0, Math.floor(DataScopeInterceptor.MAX_CACHE_SIZE * 0.2));
        for (const [evictKey] of toEvict) {
          this.localCache.delete(evictKey);
        }
      }
    }
    this.localCache.set(key, {
      value,
      expiresAt: now + this.dataScopeCacheTtlSeconds * 1000,
    });
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const dataScopeOptions = this.reflector.getAllAndOverride<DataScopeOptions>(
      DATA_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!dataScopeOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    if (!userId) {
      return next.handle();
    }

    const userIdBigInt = BigInt(userId);
    const cachedDataScope = await this.getCachedValue<RequestDataScope>(
      this.buildDataScopeCacheKey(userIdBigInt),
    );
    if (cachedDataScope) {
      request.dataScope = cachedDataScope;
      // ⚠️ 修复：这里**必须**继续做资源校验，不能直接放行。
      //
      // 原实现是 `return next.handle()` —— 于是同一次会话里
      // **第一个**请求校验了资源归属，之后命中缓存的请求全部跳过校验。
      // 实测（修复前）：张老师(scope=class 1) 的
      //   DELETE /attendance/sessions/{class2的课次} → 403（首个请求，做了校验）
      //   POST   /attendance/sessions/{同一课次}/end    → 201 成功（命中缓存，跳过校验）
      //   POST   /attendance/sessions/{同一课次}/status → 201 成功
      // 即"越权只需先发一个合法请求预热缓存" —— 校验形同虚设。
      await this.assertScopedResourceAccess(request, dataScopeOptions);
      return next.handle();
    }

    const userRoles = await this.permissionService.getUserRolesAndScopes(userIdBigInt);

    if (userRoles.length === 0) {
      const studentId = await this.getStudentIdByUserId(BigInt(userId));
      request.dataScope = {
        type: 'self',
        studentIds: studentId ? [studentId] : undefined,
      } as RequestDataScope;
      this.primeCache(this.buildDataScopeCacheKey(userIdBigInt), request.dataScope);
      await this.assertScopedResourceAccess(request, dataScopeOptions);
      return next.handle();
    }

    const hasSystemScope = userRoles.some(
      (r: { scope_type: string }) =>
        r.scope_type === 'system' || r.scope_type === 'school',
    );
    if (hasSystemScope) {
      request.dataScope = { type: 'all' } as RequestDataScope;
      this.primeCache(this.buildDataScopeCacheKey(userIdBigInt), request.dataScope);
      await this.assertScopedResourceAccess(request, dataScopeOptions);
      return next.handle();
    }

    // 纯学生侧账号（student / class_monitor）的 user_roles.scope_type 记录的是
    // “所在班级”，但这只是学生的班级归属，不代表可以查看全班数据。若沿用
    // class 范围，学生 token 调用 /admin/students 会拿到同班 30+ 人的姓名、
    // 手机号与 wx_openid。这里统一收敛为 self。
    const normalizedRoleCodes = userRoles.map((role: { role: string }) =>
      normalizeRoleCode(role.role),
    );
    const isStudentSideOnly =
      normalizedRoleCodes.length > 0 &&
      normalizedRoleCodes.every(
        (role: string) => role === 'student' || role === 'class_monitor',
      );
    if (isStudentSideOnly) {
      const studentId = await this.getStudentIdByUserId(userIdBigInt);
      request.dataScope = {
        type: 'self',
        studentIds: studentId ? [studentId] : [],
      } as RequestDataScope;
      this.primeCache(this.buildDataScopeCacheKey(userIdBigInt), request.dataScope);
      await this.assertScopedResourceAccess(request, dataScopeOptions);
      return next.handle();
    }

    const scopeIds = {
      college: [] as bigint[],
      class: [] as bigint[],
      self: [] as bigint[],
    };

    let cachedStudentId: bigint | null | undefined;
    for (const role of userRoles) {
      if ((role.scope_type === 'college' || role.scope_type === 'org') && role.scope_id) {
        scopeIds.college.push(role.scope_id);
      } else if (role.scope_type === 'class' && role.scope_id) {
        scopeIds.class.push(role.scope_id);
      } else if (role.scope_type === 'self') {
        if (cachedStudentId === undefined) {
          cachedStudentId = await this.getStudentIdByUserId(role.user_id);
        }
        if (cachedStudentId) {
          scopeIds.self.push(cachedStudentId);
        }
      }
    }

    const collegeIds =
      scopeIds.college.length > 0
        ? Array.from(new Set(scopeIds.college.map((item) => item.toString()))).map((id) =>
            BigInt(id),
          )
        : [];
    let classIds =
      scopeIds.class.length > 0
        ? Array.from(new Set(scopeIds.class.map((item) => item.toString()))).map((id) =>
            BigInt(id),
          )
        : [];
    const studentIds =
      scopeIds.self.length > 0
        ? Array.from(new Set(scopeIds.self.map((item) => item.toString()))).map((id) =>
            BigInt(id),
          )
        : [];

    // 兼容“学院范围 + 额外班级范围”混合角色：将学院下全部班级并入 classIds，
    // 避免后续控制器只按单一 type 判断时把额外班级访问范围收窄掉。
    if (collegeIds.length > 0 && classIds.length > 0) {
      const collegeClasses = await this.prisma.classes.findMany({
        where: { org_id: { in: collegeIds } },
        select: { id: true },
      });
      classIds = Array.from(
        new Set(
          [...classIds, ...collegeClasses.map((item: { id: bigint }) => item.id)].map((item) =>
            item.toString(),
          ),
        ),
      ).map((id) => BigInt(id));
    }

    request.dataScope = {
      type:
        classIds.length > 0
          ? 'class'
          : collegeIds.length > 0
            ? 'college'
            : 'self',
      collegeIds: collegeIds.length > 0 ? collegeIds : [],
      classIds: classIds.length > 0 ? classIds : [],
      // 保留空数组而不是 undefined：控制器里的 `if (dataScope.studentIds)`
      // 会把 undefined 当成“未设置范围”从而跳过过滤（教师 800 曾因此拿到
      // 全校 152 名学生）。空数组会让 `in: []` 明确返回 0 行。
      studentIds: studentIds.length > 0 ? studentIds : [],
    } as RequestDataScope;
    this.primeCache(this.buildDataScopeCacheKey(userIdBigInt), request.dataScope);

    await this.assertScopedResourceAccess(request, dataScopeOptions);

    return next.handle();
  }

  /**
   * 校验请求中出现的受范围约束资源是否落在当前用户的数据范围内。
   *
   * 抽出成独立方法，是为了让**所有**分支（命中缓存 / 无角色 / 系统范围 /
   * 正常计算）都走到同一处校验 —— 原实现只在最后一条路径上校验，
   * 命中缓存时直接 `return next.handle()`，导致首个请求之后的越权全部放行。
   */
  private async assertScopedResourceAccess(
    request: any,
    dataScopeOptions: DataScopeOptions,
  ): Promise<void> {
    const scopedChecks = this.collectScopedResourceChecks(request, dataScopeOptions);
    for (const check of scopedChecks) {
      const hasAccess = await this.checkResourceByEntity(
        check.id,
        request.dataScope as RequestDataScope,
        check.entity,
      );
      if (!hasAccess) {
        throw new ForbiddenException('权限不足，无法访问此资源');
      }
    }
  }

  private collectScopedResourceChecks(
    request: any,
    options: DataScopeOptions,
  ): ScopedResourceCheck[] {
    const checks: ScopedResourceCheck[] = [];
    const dedupe = new Set<string>();

    const addChecks = (entity: string, rawValue: unknown) => {
      for (const id of this.parseIdValues(rawValue)) {
        const key = `${entity}:${id}`;
        if (dedupe.has(key)) {
          continue;
        }
        dedupe.add(key);
        checks.push({ entity, id });
      }
    };

    // Primary id path such as /:id
    addChecks(options.entity, request?.params?.id);

    // Declared DataScope field in params/query/body
    const declaredEntity = this.resolveEntityByField(options.field, options.entity);
    if (options.field) {
      addChecks(declaredEntity, request?.params?.[options.field]);
      addChecks(declaredEntity, request?.query?.[options.field]);
      addChecks(declaredEntity, request?.body?.[options.field]);
    }

    // Common filtering ids that can otherwise override scoped queries.
    addChecks('student', request?.query?.student_id);
    addChecks('student', request?.body?.student_id);
    addChecks('class', request?.query?.class_id);
    addChecks('class', request?.body?.class_id);
    addChecks('course', request?.query?.course_id);
    addChecks('course', request?.body?.course_id);
    addChecks('warning', request?.query?.warning_id);
    addChecks('warning', request?.body?.warning_id);
    addChecks('org', request?.query?.org_id);
    addChecks('org', request?.body?.org_id);

    return checks;
  }

  private parseIdValues(rawValue: unknown): string[] {
    if (rawValue === undefined || rawValue === null) {
      return [];
    }

    if (Array.isArray(rawValue)) {
      return rawValue.flatMap((item) => this.parseIdValues(item));
    }

    const text = String(rawValue).trim();
    if (!text) {
      return [];
    }

    const parts = text.includes(',') ? text.split(',') : [text];
    const result: string[] = [];
    for (const part of parts) {
      const normalized = part.trim();
      if (!/^\d+$/.test(normalized)) {
        continue;
      }
      result.push(normalized);
    }
    return result;
  }

  private resolveEntityByField(field: string, fallbackEntity: string): string {
    const normalizedField = String(field || '').trim().toLowerCase();
    switch (normalizedField) {
      case 'student_id':
        return 'student';
      case 'class_id':
        return 'class';
      case 'course_id':
        return 'course';
      case 'warning_id':
        return 'warning';
      case 'org_id':
      case 'college_id':
        return 'org';
      case 'id':
        return fallbackEntity;
      default:
        return fallbackEntity;
    }
  }

  private async checkResourceByEntity(
    resourceId: string,
    dataScope: RequestDataScope,
    entity: string,
  ): Promise<boolean> {
    if (dataScope.type === 'all') {
      return true;
    }

    if (entity === 'org') {
      return this.checkOrgAccess(resourceId, dataScope);
    }

    return this.checkResourceAccess(resourceId, dataScope, {
      entity,
      field: 'id',
    });
  }

  private async checkOrgAccess(
    resourceId: string,
    dataScope: RequestDataScope,
  ): Promise<boolean> {
    if (dataScope.type === 'all') {
      return true;
    }

    if (dataScope.type === 'college' && dataScope.collegeIds) {
      return dataScope.collegeIds.some((id) => id.toString() === resourceId);
    }

    if (dataScope.type === 'class' && dataScope.classIds) {
      if (!dataScope.orgIds) {
        const classes = await this.prisma.classes.findMany({
          where: { id: { in: dataScope.classIds } },
          select: { org_id: true },
        });
        dataScope.orgIds = Array.from(
          new Set(classes.map((item: { org_id: bigint }) => item.org_id.toString())),
        );
      }
      return dataScope.orgIds.includes(resourceId);
    }

    if (dataScope.type === 'self' && dataScope.studentIds) {
      if (!dataScope.orgIds) {
        const students = await this.prisma.student_profiles.findMany({
          where: { id: { in: dataScope.studentIds } },
          select: { class_id: true },
        });
        const classIds = students.map((item: { class_id: bigint }) => item.class_id);
        if (classIds.length === 0) {
          dataScope.orgIds = [];
        } else {
          const classes = await this.prisma.classes.findMany({
            where: { id: { in: classIds } },
            select: { org_id: true },
          });
          dataScope.orgIds = Array.from(
            new Set(classes.map((item: { org_id: bigint }) => item.org_id.toString())),
          );
        }
      }
      return dataScope.orgIds.includes(resourceId);
    }

    return false;
  }

  private async checkResourceAccess(
    resourceId: string,
    dataScope: RequestDataScope,
    options: DataScopeOptions,
  ): Promise<boolean> {
    if (dataScope.type === 'all') {
      return true;
    }

    try {
      const id = BigInt(resourceId);

      switch (options.entity) {
        case 'student': {
          const student = await this.prisma.student_profiles.findUnique({
            where: { id },
          });
          if (!student) return false;

          if (dataScope.type === 'self' && dataScope.studentIds) {
            return dataScope.studentIds.some((sid) => sid.toString() === resourceId);
          }
          if (dataScope.type === 'class' && dataScope.classIds) {
            return dataScope.classIds.some(
              (cid) => cid.toString() === student.class_id.toString(),
            );
          }
          if (dataScope.type === 'college' && dataScope.collegeIds) {
            const classInfo = await this.prisma.classes.findUnique({
              where: { id: student.class_id },
            });
            if (!classInfo) return false;
            return dataScope.collegeIds.some(
              (oid) => oid.toString() === classInfo.org_id.toString(),
            );
          }
          break;
        }

        case 'class': {
          const classInfo = await this.prisma.classes.findUnique({
            where: { id },
          });
          if (!classInfo) return false;

          if (dataScope.type === 'class' && dataScope.classIds) {
            return dataScope.classIds.some((cid) => cid.toString() === resourceId);
          }
          if (dataScope.type === 'college' && dataScope.collegeIds) {
            return dataScope.collegeIds.some(
              (oid) => oid.toString() === classInfo.org_id.toString(),
            );
          }
          break;
        }

        case 'course': {
          const course = await this.prisma.courses.findUnique({
            where: { id },
          });
          if (!course) return false;

          if (dataScope.type === 'college' && dataScope.collegeIds) {
            return dataScope.collegeIds.some(
              (oid) => oid.toString() === course.org_id.toString(),
            );
          }
          break;
        }

        // ----------------------------------------------------------------
        // 排课（schedules）
        //
        // 与 session 同理：路由的 `:id` 是**排课 id**，不是班级 id。
        // 先由排课 id 解析出 class_id，再复用班级/学院/self 的范围判定。
        // schedules 表本身有 class_id 列，无需二次查 classes。
        // ----------------------------------------------------------------
        case 'schedule': {
          const schedule = await this.prisma.schedules.findUnique({
            where: { id },
            select: { class_id: true, course_id: true, teacher_user_id: true },
          });
          if (!schedule) return false;

          if (dataScope.type === 'class' && dataScope.classIds) {
            return dataScope.classIds.some(
              (cid) => cid.toString() === schedule.class_id.toString(),
            );
          }
          if (dataScope.type === 'self' && dataScope.classIds) {
            return dataScope.classIds.some(
              (cid) => cid.toString() === schedule.class_id.toString(),
            );
          }
          if (dataScope.type === 'college' && dataScope.collegeIds) {
            const classInfo = await this.prisma.classes.findUnique({
              where: { id: schedule.class_id },
              select: { org_id: true },
            });
            if (!classInfo) return false;
            return dataScope.collegeIds.some(
              (oid) => oid.toString() === classInfo.org_id.toString(),
            );
          }
          break;
        }

        // ----------------------------------------------------------------
        // 签到课次（class_sessions）
        //
        // 为什么需要单独的 entity：
        //   路由形如 POST /attendance/sessions/:id/end，`:id` 是**课次 id**。
        //   若声明 entity='class'，拦截器会把 `:id` 当作**班级 id** 去查
        //   classes 表 —— 课次 id 与班级 id 空间不同，必然 not found → 403。
        //   实测后果：班主任连自己班的课次都无法结束/删除（把功能改死）。
        //
        //   正确做法是先由课次 id 解析出 class_id，再复用班级范围判定。
        // ----------------------------------------------------------------
        case 'session': {
          const session = await this.prisma.class_sessions.findUnique({
            where: { id },
            select: { class_id: true },
          });
          if (!session) return false;

          if (dataScope.type === 'class' && dataScope.classIds) {
            return dataScope.classIds.some(
              (cid) => cid.toString() === session.class_id.toString(),
            );
          }
          if (dataScope.type === 'self' && dataScope.classIds) {
            return dataScope.classIds.some(
              (cid) => cid.toString() === session.class_id.toString(),
            );
          }
          if (dataScope.type === 'college' && dataScope.collegeIds) {
            const classInfo = await this.prisma.classes.findUnique({
              where: { id: session.class_id },
              select: { org_id: true },
            });
            if (!classInfo) return false;
            return dataScope.collegeIds.some(
              (oid) => oid.toString() === classInfo.org_id.toString(),
            );
          }
          break;
        }

        case 'warning': {
          const warning = await this.prisma.warnings.findUnique({
            where: { id },
          });
          if (!warning) return false;

          if (dataScope.type === 'self' && dataScope.studentIds) {
            return dataScope.studentIds.some(
              (sid) => sid.toString() === warning.student_id.toString(),
            );
          }
          if (dataScope.type === 'class' && dataScope.classIds) {
            const student = await this.prisma.student_profiles.findUnique({
              where: { id: warning.student_id },
            });
            if (!student) return false;
            return dataScope.classIds.some(
              (cid) => cid.toString() === student.class_id.toString(),
            );
          }
          if (dataScope.type === 'college' && dataScope.collegeIds) {
            const student = await this.prisma.student_profiles.findUnique({
              where: { id: warning.student_id },
            });
            if (!student) return false;
            const classInfo = await this.prisma.classes.findUnique({
              where: { id: student.class_id },
            });
            if (!classInfo) return false;
            return dataScope.collegeIds.some(
              (oid) => oid.toString() === classInfo.org_id.toString(),
            );
          }
          break;
        }

        default:
          return true;
      }
    } catch (error) {
      this.logger.error({ err: error }, '数据范围资源校验失败');
      return false;
    }

    return false;
  }

  private async getStudentIdByUserId(userId: bigint): Promise<bigint | null> {
    const cached = await this.getCachedValue<string>(this.buildStudentIdCacheKey(userId));
    if (cached && /^\d+$/.test(cached)) {
      return BigInt(cached);
    }

    const student = await this.prisma.student_profiles.findFirst({
      where: { user_id: userId },
      select: { id: true },
    });
    if (student?.id) {
      this.primeCache(this.buildStudentIdCacheKey(userId), student.id.toString());
    }
    return student?.id || null;
  }
}
