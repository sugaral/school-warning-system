# 接口清单与覆盖核对表（自动生成）

> 生成脚本：`scripts/audit-routes.js`（`--probe` 会实测 GET 连通性）

> 生成时间：2026-09-12T04:19:42.964Z

## 汇总

| 指标 | 数值 |
| --- | --- |
| Controller 文件数 | 35 |
| 路由总数 | 305 |
| GET | 139 |
| POST | 116 |
| PUT | 26 |
| DELETE | 24 |
| PATCH | 0 |
| GET 已实测连通 | 139 |
| 其中路由存在（非 404） | 139 |

> 说明：写操作（POST/PUT/DELETE）**未在探测中调用**，避免污染数据；
> 它们由 `scripts/verify-*` 系列脚本按业务场景实测（幂等/并发/导入导出等）。

## AttendanceController  `attendance`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/attendance/session-options` | getSessionOptions | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/attendance/session-options/courses` | getSessionOptionCourses | AuthGuard+PermissionGuard | attendance:manage | — | Y | OK(200) |
| GET | `/attendance/sessions` | listSessions | AuthGuard+PermissionGuard | attendance:manage | — | Y | OK(200) |
| GET | `/attendance/qr-config` | getQrConfig | AuthGuard+PermissionGuard | attendance:read | — | Y | OK(200) |
| POST | `/attendance/sessions` | createSession | AuthGuard+PermissionGuard | attendance:read | — |  |  |
| POST | `/attendance/sessions/batch-create` | batchCreateSessions | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| POST | `/attendance/sessions/batch-end` | batchEndSessions | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| POST | `/attendance/sessions/batch-end-job` | startBatchEndJob | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| POST | `/attendance/sessions/batch-delete` | batchDeleteSessions | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| POST | `/attendance/sessions/batch-delete-job` | startBatchDeleteJob | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| GET | `/attendance/batch-jobs/:id` | getBatchJob | AuthGuard+PermissionGuard | attendance:manage | — | Y | OK(200) |
| POST | `/attendance/daily-records` | upsertDailyRecord | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| POST | `/attendance/daily-records/batch` | upsertDailyRecordsBatch | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| POST | `/attendance/checkin` | checkin | AuthGuard+PermissionGuard | attendance:manage | — |  |  |
| DELETE | `/attendance/sessions/:id` | deleteSession | AuthGuard+PermissionGuard | — | — |  |  |
| GET | `/attendance/sessions/:id/attendance` | getSessionAttendance | AuthGuard+PermissionGuard | attendance:manage | — | Y | OK(200) |
| POST | `/attendance/sessions/:id/end` | endSession | AuthGuard+PermissionGuard | attendance:read | — |  |  |
| GET | `/attendance/sessions/:id/qr-state` | getSessionQrState | AuthGuard+PermissionGuard | attendance:manage | — | Y | OK(200) |
| GET | `/attendance/sessions/:id/records` | getSessionRecords | AuthGuard+PermissionGuard | attendance:read | — | Y | OK(200) |
| POST | `/attendance/sessions/:id/status` | saveSessionStatus | AuthGuard+PermissionGuard | attendance:read | — |  |  |
| POST | `/attendance/sessions/:id/students/:student_id/status` | updateStudentStatus | AuthGuard+PermissionGuard | attendance:manage | — |  |  |

## AuditController  `admin/audit`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/audit/operations` | getOperationLogs | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/admin/audit/operations/:id` | getOperationLogDetail | AuthGuard+PermissionGuard | audit:view | — | Y | OK(200) |
| GET | `/admin/audit/notifications` | getNotificationLogs | AuthGuard+PermissionGuard | audit:view | — | Y | OK(200) |
| GET | `/admin/audit/security-events` | getSecurityEvents | AuthGuard+PermissionGuard | audit:view | — | Y | OK(200) |
| GET | `/admin/audit/security-events/:id` | getSecurityEventDetail | AuthGuard+PermissionGuard | audit:view | — | Y | OK(200) |
| POST | `/admin/audit/export` | exportAuditLogs | AuthGuard+PermissionGuard | audit:view | — |  |  |

## AuditManageController  `admin/audit`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DELETE | `/admin/audit/operations/:id` | deleteOperationLog | AuthGuard+PermissionGuard | — | — |  |  |
| POST | `/admin/audit/operations/batch-delete` | batchDeleteOperationLogs | AuthGuard+PermissionGuard | audit:delete | — |  |  |
| DELETE | `/admin/audit/notifications/:id` | deleteNotificationLog | AuthGuard+PermissionGuard | audit:delete | — |  |  |
| POST | `/admin/audit/notifications/batch-delete` | batchDeleteNotificationLogs | AuthGuard+PermissionGuard | audit:delete | — |  |  |
| DELETE | `/admin/audit/security-events/:id` | deleteSecurityEvent | AuthGuard+PermissionGuard | audit:delete | — |  |  |
| POST | `/admin/audit/security-events/batch-delete` | batchDeleteSecurityEvents | AuthGuard+PermissionGuard | audit:delete | — |  |  |

## FeedbackController  `(无前缀)`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/feedback` | submitFeedback | AuthGuard | — | — |  |  |
| POST | `/admin/feedback/submit` | submitAdminFeedback | AuthGuard | — | — |  |  |
| GET | `/admin/feedback` | listFeedbacks | AuthGuard | — | — | Y | OK(200) |
| GET | `/admin/feedback/:id` | getFeedbackDetail | AuthGuard+PermissionGuard | audit:view | — | Y | OK(200) |
| POST | `/admin/feedback/:id/handle` | handleFeedback | AuthGuard+PermissionGuard | audit:view | — |  |  |

## AuthController  `auth`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/auth/login-security` | getAdminLoginSecurity | Public | — | — | Y | OK(200) |
| GET | `/auth/captcha` | getLoginCaptcha | Public | — | — | Y | OK(200) |
| POST | `/auth/recovery/options` | getRecoveryOptions | Public | — | — |  |  |
| POST | `/auth/send_code` | sendCode | ThrottlerGuard | — | — |  |  |
| POST | `/auth/recovery/send-email-code` | sendRecoveryEmailCode | Public | — | — |  |  |
| POST | `/auth/recovery/send-sms-code` | sendRecoverySmsCode | Public | — | — |  |  |
| POST | `/auth/send_login_code` | sendLoginCode | Public | — | — |  |  |
| POST | `/auth/verify_code` | verifyCode | Public | — | — |  |  |
| POST | `/auth/recovery/reset-password` | resetPassword | Public | — | — |  |  |
| POST | `/auth/login_admin` | loginAdmin | Public | — | — |  |  |
| GET | `/auth/register-status` | getRegisterStatus | Public | — | — | Y | OK(200) |
| POST | `/auth/register` | register | Public | — | — |  |  |
| GET | `/auth/roles` | getRolesForRegister | Public | — | — | Y | OK(200) |
| GET | `/auth/me` | getCurrentUser | ThrottlerGuard | — | — | Y | OK(200) |
| POST | `/auth/logout` | logout | AuthGuard | — | — |  |  |
| POST | `/auth/revoke-all-tokens` | revokeAllTokens | AuthGuard | — | — |  |  |

## ClassMonitorController  `class-monitor`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/class-monitor/stats` | getStats | AuthGuard+RolesGuard | — | — | Y | OK(403) |
| GET | `/class-monitor/warnings` | getWarnings | AuthGuard+RolesGuard | — | class_monitor | Y | OK(403) |
| GET | `/class-monitor/members` | getMembers | AuthGuard+RolesGuard | — | class_monitor | Y | OK(403) |
| POST | `/class-monitor/notifications` | createNotification | AuthGuard+RolesGuard | — | class_monitor |  |  |
| GET | `/class-monitor/notifications` | getNotifications | AuthGuard+RolesGuard | — | class_monitor | Y | OK(403) |
| GET | `/class-monitor/activities` | getActivities | AuthGuard+RolesGuard | — | class_monitor | Y | OK(403) |

## ClassesAdminController  `admin/classes`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/classes` | listClasses | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/admin/classes/:id` | getClass | AuthGuard+PermissionGuard | class:read | — | Y | OK(200) |
| POST | `/admin/classes` | createClass | AuthGuard+PermissionGuard | class:read | — |  |  |
| PUT | `/admin/classes/:id` | updateClass | AuthGuard+PermissionGuard | class:create | — |  |  |
| DELETE | `/admin/classes/:id` | deleteClass | AuthGuard+PermissionGuard | class:update | — |  |  |

## ConfigController  `admin/config`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/config` | getConfig | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| POST | `/admin/config` | setConfig | AuthGuard+PermissionGuard | config:view | — |  |  |
| GET | `/admin/config/email` | getEmailConfig | AuthGuard+PermissionGuard | config:update | — | Y | OK(200) |
| PUT | `/admin/config/email` | setEmailConfig | AuthGuard+PermissionGuard | config:view | — |  |  |
| GET | `/admin/config/sms` | getSmsConfig | AuthGuard+PermissionGuard | config:update | — | Y | OK(200) |
| PUT | `/admin/config/sms` | setSmsConfig | AuthGuard+PermissionGuard | config:view | — |  |  |
| GET | `/admin/config/import-templates` | getImportTemplates | AuthGuard+PermissionGuard | config:update | — | Y | OK(200) |
| PUT | `/admin/config/import-templates/:type` | setImportTemplate | AuthGuard+PermissionGuard | config:view | — |  |  |
| POST | `/admin/config/test-email` | testEmail | AuthGuard+PermissionGuard | config:update | — |  |  |
| POST | `/admin/config/email/test` | testEmail | AuthGuard+PermissionGuard | — | — |  |  |
| GET | `/admin/config/calendar-exclusions` | getCalendarExclusions | AuthGuard+PermissionGuard | config:update | — | Y | OK(200) |
| POST | `/admin/config/test-sms` | testSms | AuthGuard+PermissionGuard | config:view | — |  |  |
| POST | `/admin/config/sms/test` | testSms | AuthGuard+PermissionGuard | — | — |  |  |
| POST | `/admin/config/calendar-exclusions` | createCalendarExclusion | AuthGuard+PermissionGuard | config:update | — |  |  |
| DELETE | `/admin/config/calendar-exclusions/:id` | deleteCalendarExclusion | AuthGuard+PermissionGuard | config:update | — |  |  |
| GET | `/admin/config/templates` | getTemplates | AuthGuard+PermissionGuard | config:update | — | Y | OK(200) |
| POST | `/admin/config/templates/bootstrap` | bootstrapTemplates | AuthGuard+PermissionGuard | config:view | — |  |  |
| POST | `/admin/config/templates` | createTemplate | AuthGuard+PermissionGuard | config:update | — |  |  |
| PUT | `/admin/config/templates/:id` | updateTemplate | AuthGuard+PermissionGuard | config:update | — |  |  |
| DELETE | `/admin/config/templates/:id` | deleteTemplate | AuthGuard+PermissionGuard | config:update | — |  |  |

## NotificationOpenController  `admin/config/open`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/admin/config/open/email/send` | sendOpenEmail | — | — | — |  |  |
| POST | `/admin/config/open/sms/send` | sendOpenSms | — | — | — |  |  |

## CourseClassesAdminController  `admin/course-classes`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/course-classes` | listCourseClasses | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| POST | `/admin/course-classes` | createCourseClass | AuthGuard+PermissionGuard | course:read | — |  |  |
| POST | `/admin/course-classes/import` | importCourseClasses | AuthGuard+PermissionGuard | course:create | — |  |  |
| PUT | `/admin/course-classes/:id` | updateCourseClass | AuthGuard+PermissionGuard | course:create | — |  |  |
| DELETE | `/admin/course-classes/:id` | deleteCourseClass | AuthGuard+PermissionGuard | course:update | — |  |  |

## CoursesController  `admin/courses`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/admin/courses/import` | importCourses | AuthGuard+PermissionGuard | — | — |  |  |
| GET | `/admin/courses` | listCourses | AuthGuard+PermissionGuard | course:create | — | Y | OK(200) |
| POST | `/admin/courses` | createCourse | AuthGuard+PermissionGuard | course:read | — |  |  |
| PUT | `/admin/courses/:id` | updateCourse | AuthGuard+PermissionGuard | course:create | — |  |  |
| DELETE | `/admin/courses/:id` | deleteCourse | AuthGuard+PermissionGuard | course:update | — |  |  |

## HealthController  `(无前缀)`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | getHealth | — | — | — | Y | OK(200) |

## JobsController  `jobs`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/jobs/rebuild_summaries` | rebuildSummaries | AuthGuard+RolesGuard | — | — |  |  |
| GET | `/jobs/scan-status` | getScanStatus | AuthGuard+RolesGuard | — | sys_admin, student_admin, teaching_admin | Y | OK(200) |
| POST | `/jobs/process_and_generate_warnings` | processAndGenerateWarnings | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher, teaching_admin |  |  |
| POST | `/jobs/run_daily_warning` | runDailyWarning | AuthGuard+RolesGuard | — | sys_admin, student_admin, teaching_admin |  |  |
| POST | `/jobs/rescan_all_violations` | rescanAllViolations | AuthGuard+RolesGuard | — | sys_admin, student_admin, teaching_admin |  |  |
| POST | `/jobs/reconcile_recent_warnings` | reconcileRecentWarnings | AuthGuard+RolesGuard | — | sys_admin |  |  |
| POST | `/jobs/process_ended_sessions` | processEndedSessions | AuthGuard+RolesGuard | — | sys_admin |  |  |

## OrgsController  `orgs`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/orgs` | listOrgs | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| POST | `/orgs` | createOrg | AuthGuard+PermissionGuard | system:config, class:read, course:read, schedule:read, user:manage, role:manage, permission:manage, stats:view | — |  |  |
| PUT | `/orgs/:id` | updateOrg | AuthGuard+PermissionGuard | system:config | — |  |  |
| DELETE | `/orgs/:id` | deleteOrg | AuthGuard+PermissionGuard | system:config | — |  |  |
| GET | `/orgs/:orgId/majors` | listMajors | AuthGuard+PermissionGuard | system:config | — | Y | OK(200) |
| POST | `/orgs/:orgId/majors` | createMajor | AuthGuard+PermissionGuard | system:config, class:read, course:read, schedule:read, user:manage, role:manage, permission:manage, stats:view | — |  |  |
| PUT | `/orgs/majors/:id` | updateMajor | AuthGuard+PermissionGuard | system:config | — |  |  |
| DELETE | `/orgs/majors/:id` | deleteMajor | AuthGuard+PermissionGuard | system:config | — |  |  |

## PermissionController  `admin/permissions`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/permissions` | getAllPermissions | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/admin/permissions/my` | getMyPermissions | AuthGuard+PermissionGuard | permission:manage | — | Y | OK(200) |
| POST | `/admin/permissions` | createPermission | AuthGuard+PermissionGuard | — | — |  |  |
| PUT | `/admin/permissions/:id` | updatePermission | AuthGuard+PermissionGuard | permission:manage | — |  |  |
| GET | `/admin/permissions/:id/roles` | getPermissionRoles | AuthGuard+PermissionGuard | permission:manage | — | Y | OK(200) |
| DELETE | `/admin/permissions/:id` | deletePermission | AuthGuard+PermissionGuard | permission:manage | — |  |  |
| GET | `/admin/permissions/by-resource` | getPermissionsByResource | AuthGuard+PermissionGuard | permission:manage | — | Y | OK(200) |

## RoleController  `admin/roles`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/roles` | getAllRoles | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| PUT | `/admin/roles/:code` | updateRole | AuthGuard+PermissionGuard | role:manage, role:manage_monitor_titles | — |  |  |
| DELETE | `/admin/roles/:code` | deleteRole | AuthGuard+PermissionGuard | role:manage, role:manage_monitor_titles | — |  |  |
| GET | `/admin/roles/:role/permissions` | getRolePermissions | AuthGuard+PermissionGuard | role:manage | — | Y | OK(200) |
| POST | `/admin/roles/:role/permissions` | assignPermissionToRole | AuthGuard+PermissionGuard | role:manage | — |  |  |
| DELETE | `/admin/roles/:role/permissions/:permissionId` | removePermissionFromRole | AuthGuard+PermissionGuard | role:manage | — |  |  |
| POST | `/admin/roles/assign` | assignRoleToUser | AuthGuard+PermissionGuard | role:manage | — |  |  |
| DELETE | `/admin/roles/assign/:userRoleId` | removeRoleFromUser | AuthGuard+PermissionGuard | role:manage | — |  |  |
| PUT | `/admin/roles/assign/:userRoleId` | updateUserRole | AuthGuard+PermissionGuard | role:manage | — |  |  |
| GET | `/admin/roles/user/:userId` | getUserRoles | AuthGuard+PermissionGuard | role:manage | — | Y | OK(200) |
| GET | `/admin/roles/my` | getMyRoles | AuthGuard+PermissionGuard | role:manage | — | Y | OK(200) |

## ReportsController  `admin/reports`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/reports/overview` | getReportsOverview | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| POST | `/admin/reports/generate/daily` | generateDailyReport | AuthGuard+PermissionGuard | report:export | — |  |  |
| POST | `/admin/reports/generate/weekly` | generateWeeklyReport | AuthGuard+PermissionGuard | report:export | — |  |  |
| POST | `/admin/reports/generate/monthly` | generateMonthlyReport | AuthGuard+PermissionGuard | report:export | — |  |  |
| POST | `/admin/reports/generate/semester` | generateSemesterReport | AuthGuard+PermissionGuard | report:export | — |  |  |
| GET | `/admin/reports/history` | getExportHistory | AuthGuard+PermissionGuard | report:export | — | Y | OK(200) |
| POST | `/admin/reports/delete/:id` | deleteReport | AuthGuard+PermissionGuard | report:export | — |  |  |
| GET | `/admin/reports/download/:id` | downloadReport | AuthGuard+PermissionGuard | report:export | — | Y | OK(200) |

## RequestsController  `(无前缀)`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/leave_requests` | createLeaveRequest | AuthGuard+PermissionGuard | — | — |  |  |
| GET | `/leave_requests` | listLeaveRequests | AuthGuard+PermissionGuard | leave:read | — | Y | OK(200) |
| POST | `/leave_requests/:id/approve` | approveLeaveRequest | AuthGuard+PermissionGuard | leave:read | — |  |  |
| POST | `/makeup_requests` | createMakeupRequest | AuthGuard+PermissionGuard | leave:approve | — |  |  |
| GET | `/makeup_requests` | listMakeupRequests | AuthGuard+PermissionGuard | leave:read | — | Y | OK(200) |
| POST | `/makeup_requests/:id/approve` | approveMakeupRequest | AuthGuard+PermissionGuard | leave:read | — |  |  |
| POST | `/appeals` | createAppeal | AuthGuard+PermissionGuard | leave:approve | — |  |  |
| GET | `/appeals` | listAppeals | AuthGuard+PermissionGuard | appeal:read | — | Y | OK(200) |
| POST | `/appeals/:id/handle` | handleAppeal | AuthGuard+PermissionGuard | appeal:read | — |  |  |

## RulesController  `warning-rules`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/warning-rules` | listRules | AuthGuard+RolesGuard | — | — | Y | OK(200) |
| POST | `/warning-rules` | createRule | AuthGuard+RolesGuard | — | sys_admin, student_admin, teaching_admin |  |  |
| PUT | `/warning-rules/:id` | updateRule | AuthGuard+RolesGuard | — | sys_admin, student_admin |  |  |
| DELETE | `/warning-rules/:id` | deleteRule | AuthGuard+RolesGuard | — | sys_admin, student_admin |  |  |

## SchedulesAdminController  `admin/schedules`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/schedules` | listSchedules | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| POST | `/admin/schedules/import` | importSchedules | AuthGuard+PermissionGuard | schedule:read | — |  |  |
| PUT | `/admin/schedules/:id` | updateSchedule | AuthGuard+PermissionGuard | schedule:import | — |  |  |
| GET | `/admin/schedules/import-template` | getImportTemplate | AuthGuard+PermissionGuard | schedule:read | — | Y | OK(200) |
| DELETE | `/admin/schedules/:id` | deleteSchedule | AuthGuard+PermissionGuard | schedule:read | — |  |  |
| POST | `/admin/schedules/batch-delete` | batchDeleteSchedules | AuthGuard+PermissionGuard | schedule:delete | — |  |  |

## SchedulesController  `schedules`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/schedules/semester-config` | getSemesterConfig | AuthGuard | — | — | Y | OK(200) |
| GET | `/schedules` | listSchedules | AuthGuard | — | — | Y | OK(200) |
| GET | `/schedules/view` | getRoleSchedulesView | AuthGuard | — | — | Y | OK(200) |

## StatsController  `admin/stats`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/stats` | getStats | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/admin/stats/summary` | getDashboardSummary | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/org-warnings` | getOrgWarnings | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/warning-trend` | getWarningTrend | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/level-distribution` | getLevelDistribution | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/user-type-distribution` | getUserTypeDistribution | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/system-health` | getSystemHealth | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/system2` | getSystemStats2 | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |
| GET | `/admin/stats/system` | getSystemStats | AuthGuard+PermissionGuard | stats:view | — | Y | OK(200) |

## StudentAdminController  `student-admin`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/student-admin/bind-org` | bindOrg | AuthGuard+RolesGuard | — | — |  |  |
| GET | `/student-admin/dashboard` | getDashboard | AuthGuard+RolesGuard | — | sys_admin, student_admin | Y | OK(200) |
| GET | `/student-admin/rules-override` | getRulesOverride | AuthGuard+RolesGuard | — | sys_admin, student_admin | Y | OK(200) |
| POST | `/student-admin/rules-override` | setRulesOverride | AuthGuard+RolesGuard | — | sys_admin, student_admin |  |  |
| GET | `/student-admin/notification-strategy` | getNotificationStrategy | AuthGuard+RolesGuard | — | sys_admin, student_admin | Y | OK(200) |
| POST | `/student-admin/notification-strategy` | setNotificationStrategy | AuthGuard+RolesGuard | — | sys_admin, student_admin |  |  |
| GET | `/student-admin/stats-1` | getCollegeStats1 | AuthGuard+RolesGuard | — | sys_admin, student_admin | Y | OK(200) |
| GET | `/student-admin/stats-2` | getCollegeStats2 | AuthGuard+RolesGuard | — | sys_admin, student_admin | Y | OK(200) |

## StudentsAdminController  `admin/students`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/students` | listStudents | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/admin/students/export-accounts` | exportStudentAccounts | AuthGuard+PermissionGuard | student:read | — | Y | OK(200) |
| GET | `/admin/students/:id` | getStudent | AuthGuard+PermissionGuard | student:export | — | Y | OK(200) |
| POST | `/admin/students` | createStudent | AuthGuard+PermissionGuard | student:read | — |  |  |
| PUT | `/admin/students/:id` | updateStudent | AuthGuard+PermissionGuard | student:create | — |  |  |
| DELETE | `/admin/students/:id` | deleteStudent | AuthGuard+PermissionGuard | student:update | — |  |  |
| POST | `/admin/students/batch-delete` | batchDeleteStudents | AuthGuard+PermissionGuard | student:delete | — |  |  |
| POST | `/admin/students/:id/unbind-wechat` | unbindWechat | AuthGuard+PermissionGuard | student:delete | — |  |  |
| GET | `/admin/students/classes/list` | listClasses | AuthGuard+PermissionGuard | student:update | — | Y | OK(200) |
| POST | `/admin/students/import` | importStudents | AuthGuard+PermissionGuard | class:read | — |  |  |
| POST | `/admin/students/batch-create` | batchCreateStudents | AuthGuard+PermissionGuard | student:import | — |  |  |

## StudentsController  `student`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/student/login` | login | Public | — | — |  |  |
| POST | `/student/bind-wechat` | bindWechat | AuthGuard | — | — |  |  |
| POST | `/student/bind-email` | bindEmail | AuthGuard | — | — |  |  |
| GET | `/student/today` | getTodayStatus | AuthGuard | — | — | Y | OK(200) |
| GET | `/student/weekly` | getWeeklyTrend | AuthGuard | — | — | Y | OK(200) |
| GET | `/student/summaries` | getMySummaries | AuthGuard | — | — | Y | OK(200) |
| GET | `/student/courses` | getStudentCourses | AuthGuard | — | — | Y | OK(200) |
| GET | `/student/warnings` | getStudentWarnings | AuthGuard | — | — | Y | OK(200) |
| POST | `/student/warnings/:id/confirm` | confirmStudentWarning | AuthGuard | — | — |  |  |
| GET | `/student/teachers` | getTeachers | AuthGuard | — | — | Y | OK(200) |
| GET | `/student/leave_requests` | getStudentLeaveRequests | AuthGuard | — | — | Y | OK(200) |
| POST | `/student/leave_requests` | createStudentLeaveRequest | AuthGuard | — | — |  |  |
| GET | `/student/appeals` | getStudentAppeals | AuthGuard | — | — | Y | OK(200) |
| POST | `/student/appeals` | createStudentAppeal | AuthGuard | — | — |  |  |
| GET | `/student/profile` | getProfile | AuthGuard | — | — | Y | OK(200) |
| PUT | `/student/profile` | updateProfile | AuthGuard | — | — |  |  |
| POST | `/student/bind-phone` | bindPhone | AuthGuard | — | — |  |  |
| POST | `/student/change-password` | changePassword | AuthGuard | — | — |  |  |
| POST | `/student/bind-class` | bindClass | AuthGuard | — | — |  |  |
| GET | `/student/available-classes` | getAvailableClasses | Public | — | — | Y | OK(200) |
| GET | `/student/class-change-requests` | listClassChangeRequests | AuthGuard | — | — | Y | OK(200) |
| POST | `/student/class-change-requests` | createClassChangeRequest | AuthGuard | — | — |  |  |
| GET | `/student/preferences` | getPreferences | AuthGuard | — | — | Y | OK(200) |
| PUT | `/student/preferences` | updatePreferences | AuthGuard | — | — |  |  |
| GET | `/student/notifications` | getClassNotifications | AuthGuard | — | — | Y | OK(200) |
| POST | `/student/notifications/:id/read` | markNotificationAsRead | AuthGuard | — | — |  |  |

## TeacherController  `teacher`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/teacher/binding-status` | getBindingStatus | AuthGuard+RolesGuard | — | — | Y | OK(403) |
| POST | `/teacher/bind-org` | bindOrg | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |
| POST | `/teacher/bind-courses` | bindCourses | AuthGuard+RolesGuard | — | teacher |  |  |
| GET | `/teacher/orgs` | getAllOrgs | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| GET | `/teacher/courses` | getCourses | AuthGuard+RolesGuard | — | teacher | Y | OK(403) |
| GET | `/teacher/classes` | getAllClasses | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| GET | `/teacher/my-bindings` | getMyBindings | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| GET | `/teacher/sessions` | listSessions | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| GET | `/teacher/qr-config` | getQrConfig | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| POST | `/teacher/sessions` | createSession | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |
| GET | `/teacher/sessions/:id/qr-state` | getSessionQrState | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| DELETE | `/teacher/sessions/:id` | deleteSession | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |
| POST | `/teacher/sessions/:id/end` | endSession | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |
| GET | `/teacher/sessions/:id/attendance` | getSessionAttendance | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| GET | `/teacher/sessions/:id/records` | getSessionRecords | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| POST | `/teacher/sessions/:id/students/:student_id/status` | updateStudentStatus | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |
| GET | `/teacher/profile` | getProfile | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| PUT | `/teacher/profile` | updateProfile | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |
| GET | `/teacher/org-change-requests` | listOrgChangeRequests | AuthGuard+RolesGuard | — | teacher, head_teacher | Y | OK(403) |
| GET | `/teacher/course-binding-requests` | listCourseBindingRequests | AuthGuard+RolesGuard | — | teacher | Y | OK(403) |
| POST | `/teacher/org-change-requests` | createOrgChangeRequest | AuthGuard+RolesGuard | — | teacher, head_teacher |  |  |

## HeadTeacherController  `head-teacher`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/head-teacher/binding-status` | getBindingStatus | AuthGuard+RolesGuard | — | — | Y | OK(403) |
| GET | `/head-teacher/stats` | getStats | AuthGuard+RolesGuard | — | head_teacher | Y | OK(403) |
| GET | `/head-teacher/warnings` | getWarnings | AuthGuard+RolesGuard | — | head_teacher | Y | OK(403) |
| GET | `/head-teacher/leave-requests` | getLeaveRequests | AuthGuard+RolesGuard | — | head_teacher | Y | OK(403) |
| GET | `/head-teacher/orgs` | getOrgs | AuthGuard+RolesGuard | — | head_teacher | Y | OK(403) |
| GET | `/head-teacher/classes/:orgId` | getClasses | AuthGuard+RolesGuard | — | head_teacher | Y | OK(403) |
| POST | `/head-teacher/bind-class` | bindClass | AuthGuard+RolesGuard | — | head_teacher |  |  |
| GET | `/head-teacher/bindable-classes` | getBindableClasses | AuthGuard+RolesGuard | — | head_teacher | Y | OK(403) |
| GET | `/head-teacher/class-change-requests` | listClassChangeRequests | AuthGuard+RolesGuard | — | head_teacher | Y | OK(200) |
| POST | `/head-teacher/class-change-requests/:id/review` | reviewClassChangeRequest | AuthGuard+RolesGuard | — | head_teacher, sys_admin |  |  |

## TeachersAdminController  `admin/teachers`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/teachers` | listTeachers | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| GET | `/admin/teachers/:id` | getTeacher | AuthGuard+PermissionGuard | teacher:read, class:read, course:read, schedule:read | — | Y | OK(200) |
| POST | `/admin/teachers` | createTeacher | AuthGuard+PermissionGuard | teacher:read | — |  |  |
| PUT | `/admin/teachers/:id` | updateTeacher | AuthGuard+PermissionGuard | teacher:create | — |  |  |
| DELETE | `/admin/teachers/:id` | deleteTeacher | AuthGuard+PermissionGuard | teacher:update | — |  |  |

## TeachingAdminController  `teaching-admin`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/teaching-admin/course-binding-requests` | listTeacherCourseBindingRequests | AuthGuard+RolesGuard | — | — | Y | OK(200) |
| POST | `/teaching-admin/course-binding-requests/:id/approve` | approveTeacherCourseBindingRequest | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| POST | `/teaching-admin/course-binding-requests/:id/reject` | rejectTeacherCourseBindingRequest | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| GET | `/teaching-admin/semester-config` | getSemesterConfigValue | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| GET | `/teaching-admin/orgs` | getOrgs | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| GET | `/teaching-admin/classes` | getClasses | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| PUT | `/teaching-admin/semester-config` | updateSemesterConfig | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| GET | `/teaching-admin/school-stats` | getSchoolStats | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| GET | `/teaching-admin/grades` | getGrades | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| POST | `/teaching-admin/grades` | createGrade | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| PUT | `/teaching-admin/grades/:id` | updateGrade | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| DELETE | `/teaching-admin/grades/:id` | deleteGrade | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| GET | `/teaching-admin/students` | getStudents | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| PUT | `/teaching-admin/students/:id` | updateStudentProfile | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| GET | `/teaching-admin/courses` | getCourses | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| GET | `/teaching-admin/grades/stats` | getGradesStats | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| GET | `/teaching-admin/grades/export` | exportGrades | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| GET | `/teaching-admin/grades/import-template` | getGradesImportTemplate | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin | Y | OK(200) |
| POST | `/teaching-admin/grades/import-template` | setGradesImportTemplate | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |
| POST | `/teaching-admin/grades/import` | importGrades | AuthGuard+RolesGuard | — | dean, teaching_admin, sys_admin |  |  |

## UsersController  `admin/users`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/users` | getUsers | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| POST | `/admin/users` | createUser | AuthGuard+PermissionGuard | user:manage | — |  |  |
| PUT | `/admin/users/:id` | updateUser | AuthGuard+PermissionGuard | user:manage | — |  |  |
| GET | `/admin/users/:id` | getUser | AuthGuard+PermissionGuard | user:manage | — | Y | OK(200) |
| PUT | `/admin/users/:id/disable` | disableUser | AuthGuard+PermissionGuard | user:manage | — |  |  |
| PUT | `/admin/users/:id/enable` | enableUser | AuthGuard+PermissionGuard | user:manage | — |  |  |
| PUT | `/admin/users/:id/password` | resetPassword | AuthGuard+PermissionGuard | user:manage | — |  |  |
| DELETE | `/admin/users/:id` | deleteUser | AuthGuard+PermissionGuard | user:manage | — |  |  |
| GET | `/admin/users/:id/roles` | getUserRoles | AuthGuard+PermissionGuard | user:manage | — | Y | OK(200) |
| GET | `/admin/users/:id/permissions` | getUserPermissions | AuthGuard+PermissionGuard | user:manage | — | Y | OK(200) |

## ViceDeanController  `vice-dean`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/vice-dean/special-approvals` | listSpecialApprovals | AuthGuard+RolesGuard | — | — | Y | OK(200) |
| POST | `/vice-dean/approvals/:id/approve` | approve | AuthGuard+RolesGuard | — | vice_dean, sys_admin |  |  |
| POST | `/vice-dean/approvals/:id/reject` | reject | AuthGuard+RolesGuard | — | vice_dean, sys_admin |  |  |

## WarningCasesController  `warning-cases`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/warning-cases` | listCases | AuthGuard+RolesGuard | — | — | Y | OK(200) |
| GET | `/warning-cases/summary` | getSummary | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher | Y | OK(200) |
| GET | `/warning-cases/high-risk` | getHighRiskStudents | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher | Y | OK(200) |
| POST | `/warning-cases/batch-delete` | batchDeleteCases | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher |  |  |
| GET | `/warning-cases/:id` | getCaseDetail | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher | Y | OK(200) |
| GET | `/warning-cases/:id/logs` | getCaseLogs | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher | Y | OK(200) |
| POST | `/warning-cases/:id/assign` | assignCase | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher |  |  |
| POST | `/warning-cases/:id/accept` | acceptCase | AuthGuard+RolesGuard | — | sys_admin, student_admin |  |  |
| POST | `/warning-cases/:id/complete` | completeCase | AuthGuard+RolesGuard | — | head_teacher |  |  |
| DELETE | `/warning-cases/:id` | deleteCase | AuthGuard+RolesGuard | — | head_teacher |  |  |

## WarningsAdminController  `admin/warnings`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `/admin/warnings/student` | getStudentWarnings | AuthGuard+PermissionGuard | — | — | Y | OK(200) |
| DELETE | `/admin/warnings/:id` | deleteWarning | AuthGuard+PermissionGuard | warning:read | — |  |  |
| POST | `/admin/warnings/batch-delete` | batchDeleteWarnings | AuthGuard+PermissionGuard | warning:manage | — |  |  |
| POST | `/admin/warnings/clear` | clearWarnings | AuthGuard+PermissionGuard | warning:manage | — |  |  |

## WarningsController  `warnings`

| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| POST | `/warnings/jobs/run_daily_warning` | runDaily | AuthGuard+RolesGuard | — | — |  |  |
| POST | `/warnings/test/create-absent-records` | createTestAbsentRecords | AuthGuard+RolesGuard | — | sys_admin, teaching_admin |  |  |
| GET | `/warnings/class-view/students` | listClassViewStudents | AuthGuard+RolesGuard | — | sys_admin | Y | OK(200) |
| GET | `/warnings/class-view/students/:id/detail` | getClassViewStudentDetail | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher, student, dean, teaching_admin, teacher | Y | OK(200) |
| GET | `/warnings` | listWarnings | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher, student, dean, teaching_admin, teacher | Y | OK(200) |
| POST | `/warnings/:id/ack` | ackWarning | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher, student, dean, teaching_admin |  |  |
| GET | `/warnings/courses` | listCourses | AuthGuard+RolesGuard | — | sys_admin, student_admin, head_teacher, student | Y | OK(200) |
