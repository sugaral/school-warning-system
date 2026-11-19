"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var WarningsController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WarningsController = void 0;
const common_1 = require("@nestjs/common");
const dayjs_1 = __importDefault(require("dayjs"));
const timezone_1 = __importDefault(require("dayjs/plugin/timezone"));
const utc_1 = __importDefault(require("dayjs/plugin/utc"));
const auth_guard_1 = require("../shared/auth.guard");
const prisma_service_1 = require("../shared/prisma.service");
const roles_guard_1 = require("../shared/roles.guard");
const warning_service_1 = require("../warning/warning.service");
const warning_processing_service_1 = require("../warning/warning-processing.service");
const warning_snapshot_service_1 = require("../warning/warning-snapshot.service");
const config_service_1 = require("../config/config.service");
const head_teacher_scope_util_1 = require("../shared/head-teacher-scope.util");
const json_util_1 = require("../shared/json.util");
const academic_calendar_util_1 = require("../shared/academic-calendar.util");
class RunDailyWarningDto {
}
const DEFAULT_TZ = 'Asia/Shanghai';
const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'];
const CLASS_VIEW_STUDENTS_DEFAULT_PAGE_SIZE = 50;
const CLASS_VIEW_STUDENTS_MAX_PAGE_SIZE = 100;
const CLASS_VIEW_DETAIL_WARNING_LIMIT = 200;
dayjs_1.default.extend(utc_1.default);
dayjs_1.default.extend(timezone_1.default);
let WarningsController = WarningsController_1 = class WarningsController {
    constructor(prisma, warningService, warningProcessingService, warningSnapshotService, configService) {
        this.prisma = prisma;
        this.warningService = warningService;
        this.warningProcessingService = warningProcessingService;
        this.warningSnapshotService = warningSnapshotService;
        this.configService = configService;
        this.logger = new common_1.Logger(WarningsController_1.name);
    }
    async runDaily(dto, req) {
        const userId = this.getRequestUserId(req);
        const result = await this.warningService.runDailyWarning(dto.date);
        await this.prisma.audit_logs.create({
            data: {
                actor_user_id: userId,
                action: 'warning.run_daily',
                entity_type: 'warning',
                entity_id: 0n,
                after_json: (0, json_util_1.serializeForAudit)({ date: dto.date, result }),
                ip: req.ip,
                user_agent: req.headers['user-agent']
                    ? String(req.headers['user-agent']).slice(0, 255)
                    : '',
            },
        });
        return {
            code: 0,
            message: 'ok',
            data: result,
            trace_id: req.trace_id,
        };
    }
    async createTestAbsentRecords(req) {
        const students = await this.prisma.student_profiles.findMany({
            select: {
                id: true,
                class_id: true,
                org_id: true,
            },
        });
        if (students.length === 0) {
            return {
                code: 0,
                message: '没有找到学生数据',
                data: null,
                trace_id: req.trace_id,
            };
        }
        const today = new Date();
        let createdCount = 0;
        for (const student of students) {
            await this.prisma.daily_records.create({
                data: {
                    student_id: student.id,
                    record_date: today,
                    class_id: student.class_id,
                    org_id: student.org_id || 0n,
                    attendance_status: 'absent',
                    homework_status: 'unknown',
                    source: 'manual',
                    approved_status: 'approved',
                },
            });
            createdCount += 1;
        }
        return {
            code: 0,
            message: 'ok',
            data: {
                date: today.toISOString().slice(0, 10),
                records: createdCount,
            },
            trace_id: req.trace_id,
        };
    }
    async listClassViewStudents(orgId, classId, scope = 'active', keyword = '', page = '1', pageSize = String(CLASS_VIEW_STUDENTS_DEFAULT_PAGE_SIZE), req) {
        const startedAt = Date.now();
        const userId = this.getRequestUserId(req);
        const pageNumber = this.normalizePageNumber(page);
        const normalizedPageSize = this.normalizePageSize(pageSize, CLASS_VIEW_STUDENTS_DEFAULT_PAGE_SIZE, CLASS_VIEW_STUDENTS_MAX_PAGE_SIZE);
        const scopeContext = await this.resolveWarningScopeContext(userId);
        const resolvedClassId = await this.resolveScopedClassId(classId, orgId, scopeContext);
        if (!resolvedClassId) {
            return {
                code: 0,
                message: 'ok',
                data: {
                    class_id: '',
                    class_name: '',
                    org_id: '',
                    org_name: '',
                    week_label: (await this.getCurrentWeekInfo()).weekLabel,
                    students: [],
                    total: 0,
                    page: pageNumber,
                    page_size: normalizedPageSize,
                    has_more: false,
                },
                trace_id: req.trace_id,
            };
        }
        const cacheKey = await this.warningSnapshotService.buildClassViewStudentsCacheKey(userId, resolvedClassId, scope, keyword, pageNumber, normalizedPageSize);
        const cachedData = await this.warningSnapshotService.getCachedClassViewStudents(cacheKey);
        if (cachedData) {
            this.logger.log(`[预警接口] class-view/students class=${resolvedClassId.toString()} cached=true cost=${Date.now() - startedAt}ms`);
            return {
                code: 0,
                message: 'ok',
                data: cachedData,
                trace_id: req.trace_id,
            };
        }
        const classInfo = await this.prisma.classes.findUnique({
            where: { id: resolvedClassId },
            include: {
                orgs: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!classInfo) {
            return {
                code: 404,
                message: '操作失败',
                data: null,
                trace_id: req.trace_id,
            };
        }
        const normalizedKeyword = String(keyword || '').trim();
        const pageStart = (pageNumber - 1) * normalizedPageSize;
        const queryParams = [resolvedClassId];
        const whereParts = [
            'sp.class_id = ?',
            "sp.status = 'active'",
        ];
        if (scopeContext.studentId) {
            whereParts.push('sp.id = ?');
            queryParams.push(scopeContext.studentId);
        }
        if (normalizedKeyword) {
            const likeKeyword = `%${normalizedKeyword.replace(/[\\%_]/g, (matched) => `\\${matched}`)}%`;
            whereParts.push("(sp.student_no LIKE ? ESCAPE '\\\\' OR sp.major LIKE ? ESCAPE '\\\\' OR u.name LIKE ? ESCAPE '\\\\')");
            queryParams.push(likeKeyword, likeKeyword, likeKeyword);
        }
        queryParams.push(normalizedPageSize + 1, pageStart);
        const rawRows = await this.prisma.$queryRawUnsafe(`SELECT
         sp.id,
         sp.student_no,
         sp.gender,
         sp.major,
         u.name AS student_name,
         sws.active_warning_count,
         sws.closed_warning_count,
         sws.all_warning_count,
         sws.active_highest_level,
         sws.closed_highest_level,
         sws.all_highest_level,
         sws.active_last_warning_at,
         sws.closed_last_warning_at,
         sws.all_last_warning_at
       FROM student_profiles sp
       INNER JOIN users u ON u.id = sp.user_id
       LEFT JOIN student_warning_snapshots sws ON sws.student_id = sp.id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY sp.student_no ASC, sp.id ASC
       LIMIT ? OFFSET ?`, ...queryParams);
        const hasMore = rawRows.length > normalizedPageSize;
        const pageStudents = rawRows.slice(0, normalizedPageSize);
        const normalizedScope = String(scope || 'active').trim().toLowerCase();
        const students = pageStudents.map((student) => {
            const warningCount = Number(normalizedScope === 'history'
                ? student.closed_warning_count || 0
                : normalizedScope === 'all'
                    ? student.all_warning_count || 0
                    : student.active_warning_count || 0);
            const highestLevel = warningCount > 0
                ? normalizedScope === 'history'
                    ? student.closed_highest_level || ''
                    : normalizedScope === 'all'
                        ? student.all_highest_level || ''
                        : student.active_highest_level || ''
                : '';
            const lastWarningAt = warningCount > 0
                ? normalizedScope === 'history'
                    ? student.closed_last_warning_at || null
                    : normalizedScope === 'all'
                        ? student.all_last_warning_at || null
                        : student.active_last_warning_at || null
                : null;
            return {
                id: student.id.toString(),
                student_no: student.student_no || '',
                student_name: student.student_name || '未知学生',
                gender: student.gender || '',
                major: student.major || '',
                warning_count: warningCount,
                highest_level: highestLevel,
                last_warning_at: lastWarningAt,
                processing_status: '',
                processing_text: '',
            };
        });
        const approximateTotal = pageStart + students.length + (hasMore ? 1 : 0);
        const responseData = {
            class_id: classInfo.id.toString(),
            class_name: classInfo.class_name || '',
            org_id: classInfo.org_id.toString(),
            org_name: classInfo.orgs?.name || '',
            week_label: (await this.getCurrentWeekInfo()).weekLabel,
            students,
            total: approximateTotal,
            page: pageNumber,
            page_size: normalizedPageSize,
            has_more: hasMore,
        };
        this.logger.log(`[预警接口] class-view/students class=${resolvedClassId.toString()} students=${students.length} hasMore=${hasMore} page=${pageNumber} cost=${Date.now() - startedAt}ms`);
        await this.warningSnapshotService.setCachedClassViewStudents(cacheKey, responseData);
        return {
            code: 0,
            message: 'ok',
            data: responseData,
            trace_id: req.trace_id,
        };
    }
    async getClassViewStudentDetail(id, scope = 'active', view = 'day', req) {
        const startedAt = Date.now();
        const studentId = BigInt(id);
        const userId = this.getRequestUserId(req);
        const scopeContext = await this.resolveWarningScopeContext(userId);
        const cacheKey = await this.warningSnapshotService.buildClassViewStudentDetailCacheKey(userId, studentId, scope, view);
        const cachedData = await this.warningSnapshotService.getCachedClassViewStudentDetail(cacheKey);
        if (cachedData) {
            this.logger.log(`[预警接口] class-view/student-detail student=${studentId.toString()} cached=true cost=${Date.now() - startedAt}ms`);
            return {
                code: 0,
                message: 'ok',
                data: cachedData,
                trace_id: req.trace_id,
            };
        }
        const studentQueryStartedAt = Date.now();
        const student = await this.prisma.student_profiles.findUnique({
            where: { id: studentId },
            select: {
                id: true,
                student_no: true,
                gender: true,
                major: true,
                class_id: true,
                org_id: true,
                users: {
                    select: {
                        name: true,
                    },
                },
                classes: {
                    select: {
                        class_name: true,
                        org_id: true,
                        orgs: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        const studentQueryCost = Date.now() - studentQueryStartedAt;
        if (!student) {
            return {
                code: 404,
                message: '操作失败',
                data: null,
                trace_id: req.trace_id,
            };
        }
        if (!this.canAccessStudent(scopeContext, student)) {
            return await this.emptyClassViewDetail(req.trace_id);
        }
        const summaryStartedAt = Date.now();
        const [period, snapshot] = await Promise.all([
            this.resolveDetailViewPeriod(view),
            this.prisma.student_warning_snapshots.findUnique({
                where: { student_id: student.id },
            }),
        ]);
        const summaryCost = Date.now() - summaryStartedAt;
        const normalizedScope = String(scope || 'active').trim().toLowerCase();
        const warningSummary = normalizedScope === 'history'
            ? {
                highestLevel: Number(snapshot?.closed_warning_count || 0) > 0 ? snapshot?.closed_highest_level || '' : '',
                warningCount: Number(snapshot?.closed_warning_count || 0),
                lastWarningAt: Number(snapshot?.closed_warning_count || 0) > 0 ? snapshot?.closed_last_warning_at || null : null,
            }
            : normalizedScope === 'all'
                ? {
                    highestLevel: Number(snapshot?.all_warning_count || 0) > 0 ? snapshot?.all_highest_level || '' : '',
                    warningCount: Number(snapshot?.all_warning_count || 0),
                    lastWarningAt: Number(snapshot?.all_warning_count || 0) > 0 ? snapshot?.all_last_warning_at || null : null,
                }
                : {
                    highestLevel: Number(snapshot?.active_warning_count || 0) > 0 ? snapshot?.active_highest_level || '' : '',
                    warningCount: Number(snapshot?.active_warning_count || 0),
                    lastWarningAt: Number(snapshot?.active_warning_count || 0) > 0 ? snapshot?.active_last_warning_at || null : null,
                };
        const processingState = null;
        if (warningSummary.warningCount === 0) {
            const responseData = {
                student: {
                    id: student.id.toString(),
                    student_no: student.student_no || '',
                    student_name: student.users?.name || '未知学生',
                    gender: student.gender || '',
                    major: student.major || '',
                    class_id: student.class_id.toString(),
                    class_name: student.classes?.class_name || '',
                    org_id: student.classes?.org_id?.toString?.() || student.org_id?.toString?.() || '',
                    org_name: student.classes?.orgs?.name || '',
                },
                summary: {
                    warning_count: warningSummary.warningCount,
                    highest_level: warningSummary.highestLevel || '',
                    last_warning_at: warningSummary.lastWarningAt,
                    processing_status: '',
                    processing_text: '',
                },
                view: period.key,
                view_label: period.label,
                warning_items_limit: CLASS_VIEW_DETAIL_WARNING_LIMIT,
                warning_items_truncated: false,
                course_groups: [],
            };
            this.logger.log(`[预警接口] class-view/student-detail student=${student.id.toString()} view=${period.key} groups=0 fastEmpty=true studentMs=${studentQueryCost} summaryMs=${summaryCost} warningsMs=0 cost=${Date.now() - startedAt}ms`);
            await this.warningSnapshotService.setCachedClassViewStudentDetail(cacheKey, responseData);
            return {
                code: 0,
                message: 'ok',
                data: responseData,
                trace_id: req.trace_id,
            };
        }
        const warningsStartedAt = Date.now();
        const warningRows = await this.loadStudentWarnings(student.id, scope, period, CLASS_VIEW_DETAIL_WARNING_LIMIT + 1);
        const warningsCost = Date.now() - warningsStartedAt;
        const warnings = warningRows.slice(0, CLASS_VIEW_DETAIL_WARNING_LIMIT);
        const warningsTruncated = warningRows.length > CLASS_VIEW_DETAIL_WARNING_LIMIT;
        const responseData = {
            student: {
                id: student.id.toString(),
                student_no: student.student_no || '',
                student_name: student.users?.name || '未知学生',
                gender: student.gender || '',
                major: student.major || '',
                class_id: student.class_id.toString(),
                class_name: student.classes?.class_name || '',
                org_id: student.classes?.org_id?.toString?.() || student.org_id?.toString?.() || '',
                org_name: student.classes?.orgs?.name || '',
            },
            summary: {
                warning_count: warningSummary.warningCount,
                highest_level: warningSummary.highestLevel || '',
                last_warning_at: warningSummary.lastWarningAt,
                processing_status: '',
                processing_text: '',
            },
            view: period.key,
            view_label: period.label,
            warning_items_limit: CLASS_VIEW_DETAIL_WARNING_LIMIT,
            warning_items_truncated: warningsTruncated,
            course_groups: this.buildStudentCourseGroups(warnings, scope, null),
        };
        this.logger.log(`[预警接口] class-view/student-detail student=${student.id.toString()} view=${period.key} groups=${responseData.course_groups.length} studentMs=${studentQueryCost} summaryMs=${summaryCost} warningsMs=${warningsCost} cost=${Date.now() - startedAt}ms`);
        await this.warningSnapshotService.setCachedClassViewStudentDetail(cacheKey, responseData);
        return {
            code: 0,
            message: 'ok',
            data: responseData,
            trace_id: req.trace_id,
        };
    }
    async listWarnings(orgId, major, classId, status, courseId, level, scope = 'active', page = '1', pageSize = '20', req) {
        const reqStartedAt = Date.now();
        const step = (label) => {
            this.logger.warn(`[warnings.list] ${label} +${Date.now() - reqStartedAt}ms`);
        };
        step('start');
        const pageNumber = parseInt(page, 10) || 1;
        const size = parseInt(pageSize, 10) || 20;
        const userId = this.getRequestUserId(req);
        const userRoles = await this.prisma.user_roles.findMany({
            where: { user_id: userId },
        });
        step('user_roles');
        const roles = userRoles.map((item) => item.role);
        const where = {};
        where.metric = { not: 'warning_total' };
        const normalizedScope = String(scope || 'active').trim().toLowerCase();
        if (status) {
            where.status = status;
        }
        else if (normalizedScope === 'history') {
            where.status = { in: ['closed'] };
        }
        else if (normalizedScope === 'all') {
        }
        else {
            where.status = { in: ['open', 'acknowledged'] };
        }
        if (level) {
            where.level = level;
        }
        const scopedOrgIds = [];
        const scopedClassIds = [];
        if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
        }
        else if (roles.includes('student_admin')) {
            const studentAdminRole = userRoles.find((item) => item.role === 'student_admin');
            if (!studentAdminRole?.scope_id) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            scopedOrgIds.push(studentAdminRole.scope_id);
        }
        else if (roles.includes('head_teacher')) {
            const headTeacherClassIds = await (0, head_teacher_scope_util_1.getHeadTeacherClassScopeIds)(this.prisma, userId, {
                activeOnly: true,
            });
            if (headTeacherClassIds.length === 0) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            scopedClassIds.push(...headTeacherClassIds);
        }
        else if (roles.includes('student')) {
            const studentProfile = await this.prisma.student_profiles.findUnique({
                where: { user_id: userId },
                select: { id: true },
            });
            if (!studentProfile) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            where.student_id = studentProfile.id;
        }
        else if (roles.includes('teacher')) {
            const teacherBindings = await this.prisma.teacher_course_bindings.findMany({
                where: { teacher_id: userId },
                select: { class_id: true },
            });
            if (teacherBindings.length === 0) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            for (const binding of teacherBindings) {
                scopedClassIds.push(binding.class_id);
            }
        }
        else {
            return this.emptyWarningList(pageNumber, size, req.trace_id);
        }
        if (scopedOrgIds.length > 0) {
            where.org_id = { in: this.uniqueBigInts(scopedOrgIds) };
        }
        if (scopedClassIds.length > 0) {
            where.class_id = { in: this.uniqueBigInts(scopedClassIds) };
        }
        if (classId) {
            const selectedClassId = BigInt(classId);
            if (scopedClassIds.length > 0 && !scopedClassIds.some((item) => item.toString() === selectedClassId.toString())) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            where.class_id = selectedClassId;
        }
        else if (major) {
            const classes = await this.prisma.classes.findMany({
                where: {
                    major,
                    ...(orgId ? { org_id: BigInt(orgId) } : {}),
                    ...(scopedOrgIds.length > 0 ? { org_id: { in: this.uniqueBigInts(scopedOrgIds) } } : {}),
                    ...(scopedClassIds.length > 0 ? { id: { in: this.uniqueBigInts(scopedClassIds) } } : {}),
                },
                select: { id: true },
            });
            if (classes.length === 0) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            where.class_id = { in: classes.map((item) => item.id) };
        }
        else if (orgId) {
            const selectedOrgId = BigInt(orgId);
            if (scopedOrgIds.length > 0 && !scopedOrgIds.some((item) => item.toString() === selectedOrgId.toString())) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            const classes = await this.prisma.classes.findMany({
                where: {
                    org_id: selectedOrgId,
                    ...(scopedClassIds.length > 0 ? { id: { in: this.uniqueBigInts(scopedClassIds) } } : {}),
                },
                select: { id: true },
            });
            if (classes.length === 0) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            where.class_id = { in: classes.map((item) => item.id) };
        }
        if (courseId && courseId !== 'all') {
            where.course_id = BigInt(courseId);
        }
        step('scope_ready');
        const orderingField = normalizedScope === 'active' ? 'updated_at' : 'created_at';
        const paginationSource = normalizedScope === 'active' ? 'warning_current_states' : 'warnings';
        const whereSql = this.buildWarningPaginationWhereSql(where);
        const whereParams = this.buildWarningPaginationParams(where);
        const warningTotalsRows = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS warning_total FROM ${paginationSource} ${whereSql}`, ...whereParams);
        step('warning_total');
        const warningTotal = Number(warningTotalsRows?.[0]?.warning_total || 0);
        if (warningTotal === 0) {
            return this.emptyWarningList(pageNumber, size, req.trace_id);
        }
        const studentTotalRows = await this.prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT student_id) AS total FROM ${paginationSource} ${whereSql}`, ...whereParams);
        step('student_total');
        const total = Number(studentTotalRows?.[0]?.total || 0);
        const skip = (pageNumber - 1) * size;
        if (normalizedScope === 'active') {
            if (skip >= warningTotal) {
                return this.emptyWarningList(pageNumber, size, req.trace_id);
            }
            const warnings = await this.prisma.warning_current_states.findMany({
                where,
                select: {
                    id: true,
                    student_id: true,
                    class_id: true,
                    org_id: true,
                    level: true,
                    metric: true,
                    window: true,
                    period_start: true,
                    period_end: true,
                    rule_id: true,
                    rule_snapshot_json: true,
                    trigger_summary: true,
                    trigger_detail_json: true,
                    status: true,
                    created_at: true,
                    updated_at: true,
                    acknowledged_at: true,
                    acknowledged_by: true,
                    course_id: true,
                    course_key: true,
                    current_count: true,
                },
                orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
                skip,
                take: size,
            });
            step('warnings_findMany');
            const violationTotal = pageNumber === 1 && size <= 50
                ? this.computeDedupedViolationTotal(warnings)
                : null;
            const studentIds = this.uniqueBigInts(warnings.map((item) => item.student_id));
            const classIds = this.uniqueBigInts(warnings.map((item) => item.class_id));
            const processingMap = await this.warningProcessingService.getStudentProcessingMap(studentIds);
            step('processing_map');
            const [students, classes] = await Promise.all([
                this.prisma.student_profiles.findMany({
                    where: { id: { in: studentIds } },
                    select: {
                        id: true,
                        users: {
                            select: {
                                name: true,
                            },
                        },
                    },
                }),
                this.prisma.classes.findMany({
                    where: { id: { in: classIds } },
                    select: {
                        id: true,
                        class_name: true,
                        org_id: true,
                        counselor_user_id: true,
                    },
                }),
            ]);
            step('students_classes');
            const teacherIds = this.uniqueBigInts(classes.map((item) => item.counselor_user_id).filter((item) => Boolean(item)));
            const orgIds = this.uniqueBigInts([
                ...warnings.map((item) => item.org_id),
                ...classes.map((item) => item.org_id),
            ]);
            const [teachers, orgs] = await Promise.all([
                teacherIds.length > 0
                    ? this.prisma.users.findMany({
                        where: { id: { in: teacherIds } },
                        select: { id: true, name: true },
                    })
                    : Promise.resolve([]),
                orgIds.length > 0
                    ? this.prisma.orgs.findMany({
                        where: { id: { in: orgIds } },
                        select: { id: true, name: true },
                    })
                    : Promise.resolve([]),
            ]);
            step('teachers_orgs');
            const studentMap = new Map(students.map((item) => [item.id.toString(), item]));
            const classMap = new Map(classes.map((item) => [item.id.toString(), item]));
            const teacherMap = new Map(teachers.map((item) => [item.id.toString(), item]));
            const orgMap = new Map(orgs.map((item) => [item.id.toString(), item]));
            const items = warnings.map((warning) => {
                const student = studentMap.get(warning.student_id.toString());
                const classInfo = classMap.get(warning.class_id.toString());
                const teacher = classInfo?.counselor_user_id
                    ? teacherMap.get(classInfo.counselor_user_id.toString())
                    : null;
                const detail = warning.trigger_detail_json || {};
                const org = orgMap.get((classInfo?.org_id || warning.org_id).toString());
                const displayStatus = this.getDisplayStatus(warning);
                return {
                    id: warning.id.toString(),
                    student_id: warning.student_id.toString(),
                    class_id: warning.class_id.toString(),
                    org_id: warning.org_id.toString(),
                    level: warning.level,
                    metric: warning.metric,
                    window: warning.window,
                    period_start: warning.period_start,
                    period_end: warning.period_end,
                    rule_id: warning.rule_id.toString(),
                    rule_snapshot_json: warning.rule_snapshot_json,
                    trigger_summary: warning.trigger_summary,
                    trigger_detail_json: warning.trigger_detail_json,
                    course_id: detail.course_id || (warning.course_id ? warning.course_id.toString() : ''),
                    course_name: detail.course_name || '',
                    violation_count: Number(detail.violation_count || warning.current_count || 0),
                    status: warning.status,
                    display_status: displayStatus.display_status,
                    display_status_text: displayStatus.display_status_text,
                    created_at: warning.created_at,
                    updated_at: warning.updated_at,
                    acknowledged_at: warning.acknowledged_at,
                    acknowledged_by: warning.acknowledged_by?.toString(),
                    closed_at: null,
                    closed_by: '',
                    close_note: '',
                    student_name: student?.users?.name || '未知学生',
                    class_name: classInfo?.class_name || '未知班级',
                    teacher_name: teacher?.name || '未知班主任',
                    org_name: org?.name || '未知学院',
                    processing_status: processingMap.get(warning.student_id.toString())?.status || '',
                    processing_text: processingMap.get(warning.student_id.toString())?.text || '',
                };
            });
            return {
                code: 0,
                message: 'ok',
                data: {
                    total: warningTotal,
                    student_total: total,
                    warning_total: warningTotal,
                    violation_total: violationTotal,
                    page: pageNumber,
                    page_size: size,
                    items,
                },
                trace_id: req.trace_id,
            };
        }
        if (skip >= total) {
            return this.emptyWarningList(pageNumber, size, req.trace_id);
        }
        const pageStudentRows = await this.prisma.$queryRawUnsafe(`SELECT student_id
       FROM (
         SELECT student_id, MAX(${orderingField}) AS latest_order
         FROM ${paginationSource}
         ${whereSql}
         GROUP BY student_id
         ORDER BY latest_order DESC, student_id DESC
         LIMIT ? OFFSET ?
       ) page_students`, ...whereParams, size, skip);
        step('page_students');
        const pageStudentIds = pageStudentRows.map((item) => BigInt(item.student_id));
        if (pageStudentIds.length === 0) {
            return this.emptyWarningList(pageNumber, size, req.trace_id);
        }
        const pageWhere = {
            ...where,
            student_id: { in: pageStudentIds },
        };
        const includeViolationTotal = pageNumber === 1 && size <= 50;
        const warningListBaseSelect = {
            id: true,
            student_id: true,
            class_id: true,
            org_id: true,
            level: true,
            metric: true,
            window: true,
            period_start: true,
            period_end: true,
            rule_id: true,
            rule_snapshot_json: true,
            trigger_summary: true,
            trigger_detail_json: true,
            status: true,
            created_at: true,
            updated_at: true,
            acknowledged_at: true,
            acknowledged_by: true,
        };
        const activeWarningSelect = {
            ...warningListBaseSelect,
            course_id: true,
            course_key: true,
            current_count: true,
        };
        const historyWarningSelect = {
            ...warningListBaseSelect,
            closed_at: true,
            closed_by: true,
            close_note: true,
        };
        const warnings = normalizedScope === 'active'
            ? await this.prisma.warning_current_states.findMany({
                where: pageWhere,
                select: activeWarningSelect,
                orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
            })
            : await this.prisma.warnings.findMany({
                where: pageWhere,
                select: historyWarningSelect,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            });
        step('warnings_findMany');
        const violationTotal = includeViolationTotal ? this.computeDedupedViolationTotal(warnings) : null;
        const studentIds = this.uniqueBigInts(warnings.map((item) => item.student_id));
        const classIds = this.uniqueBigInts(warnings.map((item) => item.class_id));
        const processingMap = normalizedScope === 'active'
            ? await this.warningProcessingService.getStudentProcessingMap(studentIds)
            : new Map();
        step('processing_map');
        const [students, classes] = await Promise.all([
            this.prisma.student_profiles.findMany({
                where: { id: { in: studentIds } },
                select: {
                    id: true,
                    users: {
                        select: {
                            name: true,
                        },
                    },
                },
            }),
            this.prisma.classes.findMany({
                where: { id: { in: classIds } },
                select: {
                    id: true,
                    class_name: true,
                    org_id: true,
                    counselor_user_id: true,
                },
            }),
        ]);
        step('students_classes');
        const teacherIds = this.uniqueBigInts(classes.map((item) => item.counselor_user_id).filter((item) => Boolean(item)));
        const orgIds = this.uniqueBigInts([
            ...warnings.map((item) => item.org_id),
            ...classes.map((item) => item.org_id),
        ]);
        const [teachers, orgs] = await Promise.all([
            teacherIds.length > 0
                ? this.prisma.users.findMany({
                    where: { id: { in: teacherIds } },
                    select: { id: true, name: true },
                })
                : Promise.resolve([]),
            orgIds.length > 0
                ? this.prisma.orgs.findMany({
                    where: { id: { in: orgIds } },
                    select: { id: true, name: true },
                })
                : Promise.resolve([]),
        ]);
        step('teachers_orgs');
        const studentMap = new Map(students.map((item) => [item.id.toString(), item]));
        const classMap = new Map(classes.map((item) => [item.id.toString(), item]));
        const teacherMap = new Map(teachers.map((item) => [item.id.toString(), item]));
        const orgMap = new Map(orgs.map((item) => [item.id.toString(), item]));
        const items = warnings.map((warning) => {
            const student = studentMap.get(warning.student_id.toString());
            const classInfo = classMap.get(warning.class_id.toString());
            const teacher = classInfo?.counselor_user_id
                ? teacherMap.get(classInfo.counselor_user_id.toString())
                : null;
            const org = orgMap.get((classInfo?.org_id || warning.org_id).toString());
            const detail = warning.trigger_detail_json || {};
            const displayStatus = this.getDisplayStatus(warning);
            return {
                id: warning.id.toString(),
                student_id: warning.student_id.toString(),
                class_id: warning.class_id.toString(),
                org_id: warning.org_id.toString(),
                level: warning.level,
                metric: warning.metric,
                window: warning.window,
                period_start: warning.period_start,
                period_end: warning.period_end,
                rule_id: warning.rule_id.toString(),
                rule_snapshot_json: warning.rule_snapshot_json,
                trigger_summary: warning.trigger_summary,
                trigger_detail_json: warning.trigger_detail_json,
                course_id: detail.course_id || '',
                course_name: detail.course_name || '',
                violation_count: Number(detail.violation_count || 0),
                status: warning.status,
                display_status: displayStatus.display_status,
                display_status_text: displayStatus.display_status_text,
                created_at: warning.created_at,
                updated_at: warning.updated_at,
                acknowledged_at: warning.acknowledged_at,
                acknowledged_by: warning.acknowledged_by?.toString(),
                closed_at: warning.closed_at,
                closed_by: warning.closed_by?.toString(),
                close_note: warning.close_note,
                student_name: student?.users?.name || '未知学生',
                class_name: classInfo?.class_name || '未知班级',
                teacher_name: teacher?.name || '未知班主任',
                org_name: org?.name || '未知学院',
                processing_status: processingMap.get(warning.student_id.toString())?.status || '',
                processing_text: processingMap.get(warning.student_id.toString())?.text || '',
            };
        });
        return {
            code: 0,
            message: 'ok',
            data: {
                total,
                student_total: total,
                warning_total: warningTotal,
                violation_total: violationTotal,
                page: pageNumber,
                page_size: size,
                items,
            },
            trace_id: req.trace_id,
        };
    }
    async ackWarning(id, req) {
        const userId = this.getRequestUserId(req);
        const warningId = BigInt(id);
        const warning = await this.prisma.warning_current_states.findUnique({
            where: { id: warningId },
            select: {
                id: true,
                student_id: true,
                class_id: true,
                org_id: true,
            },
        });
        if (!warning) {
            return {
                code: 404,
                message: '操作失败',
                data: null,
                trace_id: req.trace_id,
            };
        }
        const userRoles = await this.prisma.user_roles.findMany({
            where: { user_id: userId },
        });
        const roles = userRoles.map((item) => item.role);
        if (!roles.includes('sys_admin')) {
            if (roles.includes('student_admin')) {
                const scopedRole = userRoles.find((item) => item.role === 'student_admin');
                if (!scopedRole?.scope_id || scopedRole.scope_id.toString() !== warning.org_id.toString()) {
                    return this.forbidden(req.trace_id);
                }
            }
            else if (roles.includes('head_teacher')) {
                const headTeacherClassIds = await (0, head_teacher_scope_util_1.getHeadTeacherClassScopeIds)(this.prisma, userId, {
                    activeOnly: true,
                });
                if (headTeacherClassIds.length === 0
                    || !headTeacherClassIds.some((item) => item.toString() === warning.class_id.toString())) {
                    return this.forbidden(req.trace_id);
                }
            }
            else if (roles.includes('student')) {
                const studentProfile = await this.prisma.student_profiles.findUnique({
                    where: { user_id: userId },
                    select: { id: true },
                });
                if (!studentProfile || studentProfile.id.toString() !== warning.student_id.toString()) {
                    return this.forbidden(req.trace_id);
                }
            }
            else {
                return this.forbidden(req.trace_id);
            }
        }
        const updatedWarning = await this.prisma.warning_current_states.update({
            where: { id: warningId },
            data: {
                status: 'acknowledged',
                acknowledged_at: new Date(),
                acknowledged_by: userId,
            },
        });
        await this.prisma.warnings.create({
            data: {
                student_id: updatedWarning.student_id,
                class_id: updatedWarning.class_id,
                org_id: updatedWarning.org_id,
                metric: updatedWarning.metric,
                level: updatedWarning.level,
                window: updatedWarning.window,
                period_start: updatedWarning.period_start,
                period_end: updatedWarning.period_end,
                rule_id: updatedWarning.rule_id,
                rule_snapshot_json: updatedWarning.rule_snapshot_json,
                trigger_summary: updatedWarning.trigger_summary,
                trigger_detail_json: updatedWarning.trigger_detail_json,
                status: 'acknowledged',
                acknowledged_at: updatedWarning.acknowledged_at,
                acknowledged_by: updatedWarning.acknowledged_by,
            },
        });
        await this.prisma.audit_logs.create({
            data: {
                actor_user_id: userId,
                action: 'warning.ack',
                entity_type: 'warning',
                entity_id: updatedWarning.id,
                after_json: { status: 'acknowledged' },
                ip: req.ip,
                user_agent: req.headers['user-agent']
                    ? String(req.headers['user-agent']).slice(0, 255)
                    : '',
            },
        });
        await this.warningSnapshotService.invalidateStudents([warning.student_id], [warning.class_id]);
        return {
            code: 0,
            message: 'ok',
            data: { id: updatedWarning.id.toString() },
            trace_id: req.trace_id,
        };
    }
    async listCourses(orgId, classId, req) {
        const userId = this.getRequestUserId(req);
        const userRoles = await this.prisma.user_roles.findMany({
            where: { user_id: userId },
        });
        const roles = userRoles.map((item) => item.role);
        const where = {
            status: { in: ['open', 'acknowledged'] },
            metric: { not: 'warning_total' },
        };
        const scopedOrgIds = [];
        const scopedClassIds = [];
        if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
        }
        else if (roles.includes('student_admin')) {
            const studentAdminRole = userRoles.find((item) => item.role === 'student_admin');
            if (!studentAdminRole?.scope_id) {
                return {
                    code: 0,
                    message: 'ok',
                    data: [],
                    trace_id: req.trace_id,
                };
            }
            scopedOrgIds.push(studentAdminRole.scope_id);
        }
        else if (roles.includes('head_teacher')) {
            const headTeacherClassIds = await (0, head_teacher_scope_util_1.getHeadTeacherClassScopeIds)(this.prisma, userId, {
                activeOnly: true,
            });
            if (headTeacherClassIds.length === 0) {
                return {
                    code: 0,
                    message: 'ok',
                    data: [],
                    trace_id: req.trace_id,
                };
            }
            scopedClassIds.push(...headTeacherClassIds);
        }
        else if (roles.includes('student')) {
            const studentProfile = await this.prisma.student_profiles.findUnique({
                where: { user_id: userId },
                select: { id: true },
            });
            if (!studentProfile) {
                return {
                    code: 0,
                    message: 'ok',
                    data: [],
                    trace_id: req.trace_id,
                };
            }
            where.student_id = studentProfile.id;
        }
        else if (roles.includes('teacher')) {
            const teacherBindings = await this.prisma.teacher_course_bindings.findMany({
                where: { teacher_id: userId },
                select: { class_id: true },
            });
            if (teacherBindings.length === 0) {
                return {
                    code: 0,
                    message: 'ok',
                    data: [],
                    trace_id: req.trace_id,
                };
            }
            for (const binding of teacherBindings) {
                scopedClassIds.push(binding.class_id);
            }
        }
        else {
            return {
                code: 0,
                message: 'ok',
                data: [],
                trace_id: req.trace_id,
            };
        }
        if (scopedOrgIds.length > 0) {
            where.org_id = { in: this.uniqueBigInts(scopedOrgIds) };
        }
        if (scopedClassIds.length > 0) {
            where.class_id = { in: this.uniqueBigInts(scopedClassIds) };
        }
        if (classId) {
            const selectedClassId = BigInt(classId);
            if (scopedClassIds.length > 0 &&
                !scopedClassIds.some((item) => item.toString() === selectedClassId.toString())) {
                return {
                    code: 0,
                    message: 'ok',
                    data: [],
                    trace_id: req.trace_id,
                };
            }
            if (scopedOrgIds.length > 0) {
                const classInScope = await this.prisma.classes.findFirst({
                    where: {
                        id: selectedClassId,
                        org_id: { in: this.uniqueBigInts(scopedOrgIds) },
                    },
                    select: { id: true },
                });
                if (!classInScope) {
                    return {
                        code: 0,
                        message: 'ok',
                        data: [],
                        trace_id: req.trace_id,
                    };
                }
            }
            where.class_id = selectedClassId;
        }
        else if (orgId) {
            const selectedOrgId = BigInt(orgId);
            if (scopedOrgIds.length > 0 &&
                !scopedOrgIds.some((item) => item.toString() === selectedOrgId.toString())) {
                return {
                    code: 0,
                    message: 'ok',
                    data: [],
                    trace_id: req.trace_id,
                };
            }
            if (scopedClassIds.length > 0) {
                const classes = await this.prisma.classes.findMany({
                    where: {
                        org_id: selectedOrgId,
                        id: { in: this.uniqueBigInts(scopedClassIds) },
                    },
                    select: { id: true },
                });
                if (classes.length === 0) {
                    return {
                        code: 0,
                        message: 'ok',
                        data: [],
                        trace_id: req.trace_id,
                    };
                }
                where.class_id = { in: classes.map((item) => item.id) };
            }
            else {
                where.org_id = selectedOrgId;
            }
        }
        const warnings = await this.prisma.warning_current_states.findMany({
            where,
            select: {
                trigger_detail_json: true,
            },
        });
        const courseIdMap = new Map();
        for (const warning of warnings) {
            const detail = warning.trigger_detail_json;
            const rawCourseId = detail?.course_id ?? detail?.courseId;
            const normalizedCourseId = String(rawCourseId || '').trim();
            if (!/^\d+$/.test(normalizedCourseId)) {
                continue;
            }
            courseIdMap.set(normalizedCourseId, BigInt(normalizedCourseId));
        }
        const courseIds = Array.from(courseIdMap.values());
        if (courseIds.length === 0) {
            return {
                code: 0,
                message: 'ok',
                data: [],
                trace_id: req.trace_id,
            };
        }
        const courses = await this.prisma.courses.findMany({
            where: {
                id: { in: courseIds },
            },
            select: {
                id: true,
                course_name: true,
            },
            orderBy: {
                course_name: 'asc',
            },
        });
        return {
            code: 0,
            message: 'ok',
            data: courses.map((course) => ({
                id: course.id.toString(),
                course_name: course.course_name,
            })),
            trace_id: req.trace_id,
        };
    }
    getRequestUserId(req) {
        return BigInt(req.user?.sub || req.user?.userId);
    }
    uniqueBigInts(values) {
        const map = new Map();
        for (const value of values) {
            if (!value) {
                continue;
            }
            map.set(value.toString(), value);
        }
        return Array.from(map.values());
    }
    computeDedupedViolationTotal(warnings) {
        const counter = new Map();
        for (const warning of warnings) {
            const detail = warning?.trigger_detail_json || {};
            if (String(warning?.metric || '').trim() === 'warning_total') {
                continue;
            }
            const courseId = String(detail.course_id || '').trim() || '__none__';
            const metric = String(warning?.metric || detail.violation_type || '').trim() || '__unknown__';
            const key = [warning.student_id.toString(), courseId, metric].join('_');
            const nextValue = Number(detail.violation_count || 0) || 0;
            const currentValue = counter.get(key) || 0;
            if (nextValue > currentValue) {
                counter.set(key, nextValue);
            }
        }
        return Array.from(counter.values()).reduce((sum, value) => sum + value, 0);
    }
    buildWarningPaginationWhereSql(where) {
        const clauses = [];
        if (where.metric?.not) {
            clauses.push('metric <> ?');
        }
        if (typeof where.status === 'string') {
            clauses.push('status = ?');
        }
        else if (Array.isArray(where.status?.in) && where.status.in.length > 0) {
            clauses.push(`status IN (${where.status.in.map(() => '?').join(', ')})`);
        }
        if (typeof where.level === 'string' && where.level) {
            clauses.push('level = ?');
        }
        if (typeof where.student_id === 'bigint') {
            clauses.push('student_id = ?');
        }
        if (typeof where.class_id === 'bigint') {
            clauses.push('class_id = ?');
        }
        else if (Array.isArray(where.class_id?.in) && where.class_id.in.length > 0) {
            clauses.push(`class_id IN (${where.class_id.in.map(() => '?').join(', ')})`);
        }
        if (typeof where.org_id === 'bigint') {
            clauses.push('org_id = ?');
        }
        else if (Array.isArray(where.org_id?.in) && where.org_id.in.length > 0) {
            clauses.push(`org_id IN (${where.org_id.in.map(() => '?').join(', ')})`);
        }
        if (typeof where.course_id === 'bigint') {
            clauses.push('course_id = ?');
        }
        return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    }
    buildWarningPaginationParams(where) {
        const params = [];
        if (where.metric?.not) {
            params.push(where.metric.not);
        }
        if (typeof where.status === 'string') {
            params.push(where.status);
        }
        else if (Array.isArray(where.status?.in) && where.status.in.length > 0) {
            params.push(...where.status.in);
        }
        if (typeof where.level === 'string' && where.level) {
            params.push(where.level);
        }
        if (typeof where.student_id === 'bigint') {
            params.push(where.student_id);
        }
        if (typeof where.class_id === 'bigint') {
            params.push(where.class_id);
        }
        else if (Array.isArray(where.class_id?.in) && where.class_id.in.length > 0) {
            params.push(...where.class_id.in);
        }
        if (typeof where.org_id === 'bigint') {
            params.push(where.org_id);
        }
        else if (Array.isArray(where.org_id?.in) && where.org_id.in.length > 0) {
            params.push(...where.org_id.in);
        }
        if (typeof where.course_id === 'bigint') {
            params.push(where.course_id);
        }
        return params;
    }
    async resolveWarningScopeContext(userId) {
        const userRoles = await this.prisma.user_roles.findMany({
            where: { user_id: userId },
        });
        const roles = userRoles.map((item) => item.role);
        const scopedOrgIds = [];
        const scopedClassIds = [];
        let studentId;
        if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
            return { roles, scopedOrgIds, scopedClassIds };
        }
        if (roles.includes('student_admin')) {
            const studentAdminRole = userRoles.find((item) => item.role === 'student_admin');
            if (studentAdminRole?.scope_id) {
                scopedOrgIds.push(studentAdminRole.scope_id);
            }
            return { roles, scopedOrgIds, scopedClassIds };
        }
        if (roles.includes('head_teacher')) {
            const headTeacherClassIds = await (0, head_teacher_scope_util_1.getHeadTeacherClassScopeIds)(this.prisma, userId, {
                activeOnly: true,
            });
            scopedClassIds.push(...headTeacherClassIds);
            return { roles, scopedOrgIds, scopedClassIds };
        }
        if (roles.includes('teacher')) {
            const teacherBindings = await this.prisma.teacher_course_bindings.findMany({
                where: { teacher_id: userId },
                select: { class_id: true },
            });
            teacherBindings.forEach((item) => scopedClassIds.push(item.class_id));
            return { roles, scopedOrgIds, scopedClassIds };
        }
        if (roles.includes('student')) {
            const studentProfile = await this.prisma.student_profiles.findUnique({
                where: { user_id: userId },
                select: { id: true, class_id: true },
            });
            if (studentProfile) {
                studentId = studentProfile.id;
                scopedClassIds.push(studentProfile.class_id);
            }
            return { roles, scopedOrgIds, scopedClassIds, studentId };
        }
        return { roles, scopedOrgIds, scopedClassIds, studentId };
    }
    async resolveScopedClassId(classId, orgId, context) {
        const normalizedClassId = String(classId || '').trim();
        if (/^\d+$/.test(normalizedClassId)) {
            const selectedClassId = BigInt(normalizedClassId);
            if (context.scopedClassIds.length > 0 &&
                !context.scopedClassIds.some((item) => item.toString() === selectedClassId.toString())) {
                return null;
            }
            if (context.scopedOrgIds.length > 0) {
                const classInScope = await this.prisma.classes.findFirst({
                    where: {
                        id: selectedClassId,
                        org_id: { in: this.uniqueBigInts(context.scopedOrgIds) },
                    },
                    select: { id: true },
                });
                if (!classInScope) {
                    return null;
                }
            }
            return selectedClassId;
        }
        const where = { status: 'active' };
        if (context.scopedClassIds.length > 0) {
            where.id = { in: this.uniqueBigInts(context.scopedClassIds) };
        }
        if (context.scopedOrgIds.length > 0) {
            where.org_id = { in: this.uniqueBigInts(context.scopedOrgIds) };
        }
        if (/^\d+$/.test(String(orgId || '').trim())) {
            where.org_id = BigInt(orgId);
        }
        const fallbackClass = await this.prisma.classes.findFirst({
            where,
            orderBy: [{ class_name: 'asc' }, { id: 'asc' }],
            select: { id: true },
        });
        return fallbackClass?.id || null;
    }
    canAccessStudent(context, student) {
        if (context.studentId && context.studentId.toString() !== student.id.toString()) {
            return false;
        }
        if (context.scopedClassIds.length > 0 &&
            !context.scopedClassIds.some((item) => item.toString() === student.class_id.toString())) {
            return false;
        }
        if (context.scopedOrgIds.length > 0 &&
            !context.scopedOrgIds.some((item) => item.toString() === (student.org_id || student.classes?.org_id || 0n).toString())) {
            return false;
        }
        return true;
    }
    async getCurrentWeekInfo(referenceDate = new Date()) {
        const teachingConfig = await this.configService.getSectionConfig('teaching', {});
        return (0, academic_calendar_util_1.getAcademicWeekInfo)(referenceDate, (0, academic_calendar_util_1.resolveSemesterStartDate)(teachingConfig?.semesterStartDate, referenceDate));
    }
    async getCurrentPeriods(referenceDate = new Date()) {
        const now = (0, dayjs_1.default)(referenceDate).tz(DEFAULT_TZ);
        const weekInfo = await this.getCurrentWeekInfo(referenceDate);
        return {
            todayStart: now.startOf('day').toDate(),
            todayEnd: now.endOf('day').toDate(),
            weekStart: weekInfo.weekStart,
            weekEnd: (0, dayjs_1.default)(weekInfo.weekEnd).endOf('day').toDate(),
            monthStart: now.startOf('month').toDate(),
            monthEnd: now.endOf('month').toDate(),
            weekLabel: weekInfo.weekLabel,
        };
    }
    applyWarningScopeFilter(where, scope) {
        const normalizedScope = String(scope || 'active').trim().toLowerCase();
        if (normalizedScope === 'history') {
            where.status = { in: ['closed'] };
        }
        else if (normalizedScope === 'all') {
        }
        else {
            where.status = { in: ['open', 'acknowledged'] };
        }
    }
    async buildStudentWarningSummaryMap(studentIds, scope) {
        const map = new Map();
        if (studentIds.length === 0) {
            return map;
        }
        const snapshots = await this.warningSnapshotService.getOrRefreshStudentSnapshots(studentIds);
        const normalizedScope = String(scope || 'active').trim().toLowerCase();
        for (const studentId of studentIds) {
            const snapshot = snapshots.get(studentId.toString());
            if (!snapshot) {
                continue;
            }
            if (normalizedScope === 'history') {
                const warningCount = Number(snapshot.closed_warning_count || 0);
                map.set(studentId.toString(), {
                    highestLevel: warningCount > 0 ? snapshot.closed_highest_level || '' : '',
                    warningCount,
                    lastWarningAt: warningCount > 0 ? snapshot.closed_last_warning_at || null : null,
                });
                continue;
            }
            if (normalizedScope === 'all') {
                const warningCount = Number(snapshot.all_warning_count || 0);
                map.set(studentId.toString(), {
                    highestLevel: warningCount > 0 ? snapshot.all_highest_level || '' : '',
                    warningCount,
                    lastWarningAt: warningCount > 0 ? snapshot.all_last_warning_at || null : null,
                });
                continue;
            }
            const warningCount = Number(snapshot.active_warning_count || 0);
            map.set(studentId.toString(), {
                highestLevel: warningCount > 0 ? snapshot.active_highest_level || '' : '',
                warningCount,
                lastWarningAt: warningCount > 0 ? snapshot.active_last_warning_at || null : null,
            });
        }
        return map;
    }
    async buildStudentAbnormalSummaryMap(studentIds) {
        const map = new Map();
        if (studentIds.length === 0) {
            return map;
        }
        const snapshots = await this.warningSnapshotService.getOrRefreshStudentSnapshots(studentIds);
        for (const studentId of studentIds) {
            const snapshot = snapshots.get(studentId.toString());
            if (!snapshot) {
                continue;
            }
            map.set(studentId.toString(), {
                todayCount: Number(snapshot.today_warning_total || 0),
                weekCount: Number(snapshot.week_warning_total || 0),
                monthCount: Number(snapshot.month_warning_total || 0),
            });
        }
        return map;
    }
    async resolveDetailViewPeriod(view) {
        const periods = await this.getCurrentPeriods();
        const normalizedView = String(view || 'day').trim().toLowerCase();
        if (normalizedView === 'week') {
            return {
                key: 'week',
                start: periods.weekStart,
                end: periods.weekEnd,
                label: periods.weekLabel,
            };
        }
        if (normalizedView === 'month') {
            return {
                key: 'month',
                start: periods.monthStart,
                end: periods.monthEnd,
                label: '本月',
            };
        }
        if (normalizedView === 'all') {
            return {
                key: 'all',
                start: (0, dayjs_1.default)().tz(DEFAULT_TZ).subtract(60, 'day').startOf('day').toDate(),
                end: new Date(),
                label: '全部预警',
            };
        }
        return {
            key: 'day',
            start: periods.todayStart,
            end: periods.todayEnd,
            label: '今日预警',
        };
    }
    async loadStudentWarnings(studentId, scope, period, limit = CLASS_VIEW_DETAIL_WARNING_LIMIT) {
        const where = {
            student_id: studentId,
            metric: { not: 'warning_total' },
        };
        this.applyWarningScopeFilter(where, scope);
        where.period_start = { lte: period.end };
        where.period_end = { gte: period.start };
        if (period.key !== 'all') {
            where.window = period.key;
        }
        if (String(scope || 'active').trim().toLowerCase() === 'active') {
            return this.prisma.warning_current_states.findMany({
                where,
                orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
                take: limit,
            });
        }
        return this.prisma.warnings.findMany({
            where,
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            take: limit,
        });
    }
    buildStudentCourseGroups(warnings, scope, processingState) {
        const groups = new Map();
        const levelWeight = {
            yellow: 1,
            orange: 2,
            red: 3,
            severe: 4,
        };
        warnings.forEach((warning) => {
            const detail = warning.trigger_detail_json || {};
            const courseId = String(detail.course_id || '').trim() || '__none__';
            const courseName = String(detail.course_name || '').trim() || '未区分课程';
            const displayStatus = this.getDisplayStatus(warning);
            const current = groups.get(courseId) || {
                course_id: courseId === '__none__' ? '' : courseId,
                course_name: courseName,
                highest_level: '',
                warning_count: 0,
                warning_total_count: 0,
                warning_items: [],
            };
            current.warning_count += 1;
            current.warning_total_count += Number(detail.violation_count || 0) || 0;
            if ((levelWeight[warning.level] || 0) > (levelWeight[current.highest_level] || 0)) {
                current.highest_level = warning.level;
            }
            current.warning_items.push({
                id: warning.id.toString(),
                level: warning.level,
                level_text: this.getLevelText(warning.level),
                metric: warning.metric,
                metric_text: this.getWarningMetricText(warning),
                window: warning.window,
                window_text: this.getWindowText(warning.window),
                violation_count: Number(detail.violation_count || 0),
                trigger_summary: warning.trigger_summary,
                status: warning.status,
                status_text: this.getStatusText(warning.status),
                display_status: displayStatus.display_status,
                display_status_text: displayStatus.display_status_text,
                created_at: warning.created_at,
                close_note: warning.close_note || '',
                processing_status: processingState?.status || '',
                processing_text: processingState?.text || '',
            });
            groups.set(courseId, current);
        });
        const isActiveScope = String(scope || 'active').trim().toLowerCase() === 'active';
        return Array.from(groups.values())
            .map((group) => {
            const warningItems = group.warning_items.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
            return {
                ...group,
                warning_count: isActiveScope ? (warningItems.length > 0 ? 1 : 0) : group.warning_count,
                warning_items: warningItems,
            };
        })
            .filter((group) => (group.warning_items?.length || 0) > 0)
            .sort((left, right) => {
            const levelDiff = (levelWeight[right.highest_level] || 0) - (levelWeight[left.highest_level] || 0);
            if (levelDiff !== 0) {
                return levelDiff;
            }
            return (right.warning_count || 0) - (left.warning_count || 0);
        });
    }
    normalizePageNumber(value) {
        const pageNumber = Number.parseInt(String(value || '1'), 10);
        return Math.max(1, Number.isFinite(pageNumber) ? pageNumber : 1);
    }
    normalizePageSize(value, fallback, max) {
        const pageSize = Number.parseInt(String(value || fallback), 10);
        if (!Number.isFinite(pageSize) || pageSize <= 0) {
            return fallback;
        }
        return Math.min(max, pageSize);
    }
    filterStudentsByKeyword(students, keyword) {
        const normalizedKeyword = String(keyword || '').trim().toLowerCase();
        if (!normalizedKeyword) {
            return students;
        }
        return students.filter((student) => {
            const candidate = [
                student.student_no,
                student.users?.name,
                student.major,
            ]
                .map((item) => String(item || '').toLowerCase())
                .join(' ');
            return candidate.includes(normalizedKeyword);
        });
    }
    getMetricText(metric) {
        const map = {
            late: '迟到',
            absent: '缺勤',
            early_leave: '早退',
            warning_total: '累计预警',
        };
        return map[metric] || metric || '-';
    }
    getWarningMetricText(warning) {
        const detail = warning?.trigger_detail_json || {};
        const hasAggregateCounts = Number(detail.late_count || 0) > 0 ||
            Number(detail.absent_count || 0) > 0 ||
            Number(detail.early_leave_count || 0) > 0;
        if (hasAggregateCounts) {
            return '综合异常';
        }
        return this.getMetricText(String(warning?.metric || ''));
    }
    getWindowText(window) {
        const map = {
            day: '日',
            week: '周',
            month: '月',
            term: '学期',
        };
        return map[window] || window || '-';
    }
    isRelatedInfoSyncWarning(warning) {
        const status = String(warning?.status || '').trim().toLowerCase();
        const closeNote = String(warning?.close_note || '').trim();
        if (status !== 'closed' || !closeNote) {
            return false;
        }
        return [
            '系统重算后该课程在当前时间窗内已不再满足预警条件',
            '系统重算后该异常事件已不存在，自动关闭对应日预警',
            '系统重算后该异常事件已不再命中日预警规则',
            '系统重算后已不再满足当前预警规则',
        ].includes(closeNote);
    }
    getDisplayStatus(warning) {
        const status = String(warning?.status || '').trim();
        if (this.isRelatedInfoSyncWarning(warning)) {
            return {
                display_status: 'synced',
                display_status_text: '相关信息同步',
            };
        }
        return {
            display_status: status,
            display_status_text: this.getStatusText(status),
        };
    }
    getStatusText(status) {
        const map = {
            open: '待确认',
            acknowledged: '已确认',
            closed: '已关闭',
        };
        return map[status] || status || '-';
    }
    getLevelText(level) {
        const map = {
            yellow: '黄色预警',
            orange: '橙色预警',
            red: '红色预警',
            severe: '严重预警',
        };
        return map[level] || level || '-';
    }
    async emptyClassViewDetail(traceId) {
        return {
            code: 0,
            message: 'ok',
            data: {
                student: null,
                summary: {
                    warning_count: 0,
                    highest_level: '',
                    last_warning_at: null,
                    processing_status: '',
                    processing_text: '',
                },
                view: 'day',
                view_label: '今日预警',
                course_groups: [],
            },
            trace_id: traceId,
        };
    }
    emptyWarningList(pageNumber, pageSize, traceId) {
        return {
            code: 0,
            message: 'ok',
            data: {
                total: 0,
                student_total: 0,
                warning_total: 0,
                violation_total: 0,
                page: pageNumber,
                page_size: pageSize,
                items: [],
            },
            trace_id: traceId,
        };
    }
    forbidden(traceId) {
        return {
            code: 403,
            message: '操作失败',
            data: null,
            trace_id: traceId,
        };
    }
};
exports.WarningsController = WarningsController;
__decorate([
    (0, common_1.Post)('jobs/run_daily_warning'),
    (0, roles_guard_1.Roles)('sys_admin', 'teaching_admin'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [RunDailyWarningDto, Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "runDaily", null);
__decorate([
    (0, common_1.Post)('test/create-absent-records'),
    (0, roles_guard_1.Roles)('sys_admin'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "createTestAbsentRecords", null);
__decorate([
    (0, common_1.Get)('class-view/students'),
    (0, roles_guard_1.Roles)('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin', 'teacher'),
    __param(0, (0, common_1.Query)('org_id')),
    __param(1, (0, common_1.Query)('class_id')),
    __param(2, (0, common_1.Query)('scope')),
    __param(3, (0, common_1.Query)('keyword')),
    __param(4, (0, common_1.Query)('page')),
    __param(5, (0, common_1.Query)('page_size')),
    __param(6, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "listClassViewStudents", null);
__decorate([
    (0, common_1.Get)('class-view/students/:id/detail'),
    (0, roles_guard_1.Roles)('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin', 'teacher'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('scope')),
    __param(2, (0, common_1.Query)('view')),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "getClassViewStudentDetail", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_guard_1.Roles)('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin'),
    __param(0, (0, common_1.Query)('org_id')),
    __param(1, (0, common_1.Query)('major')),
    __param(2, (0, common_1.Query)('class_id')),
    __param(3, (0, common_1.Query)('status')),
    __param(4, (0, common_1.Query)('course_id')),
    __param(5, (0, common_1.Query)('level')),
    __param(6, (0, common_1.Query)('scope')),
    __param(7, (0, common_1.Query)('page')),
    __param(8, (0, common_1.Query)('page_size')),
    __param(9, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "listWarnings", null);
__decorate([
    (0, common_1.Post)(':id/ack'),
    (0, roles_guard_1.Roles)('sys_admin', 'student_admin', 'head_teacher', 'student'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "ackWarning", null);
__decorate([
    (0, common_1.Get)('courses'),
    (0, roles_guard_1.Roles)('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin', 'teacher'),
    __param(0, (0, common_1.Query)('org_id')),
    __param(1, (0, common_1.Query)('class_id')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], WarningsController.prototype, "listCourses", null);
exports.WarningsController = WarningsController = WarningsController_1 = __decorate([
    (0, common_1.Controller)('warnings'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        warning_service_1.WarningService,
        warning_processing_service_1.WarningProcessingService,
        warning_snapshot_service_1.WarningSnapshotService,
        config_service_1.ConfigService])
], WarningsController);
//# sourceMappingURL=warnings.controller.js.map