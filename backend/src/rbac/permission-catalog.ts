/**
 * 权限目录（单一事实来源）
 *
 * 背景（P2-1 缺陷修复，实测严重度高于预期）：
 * 权限目录原本硬编码在 `init-permissions.ts` 这个 **独立 CLI 脚本** 里，
 * 而运行期的 `PermissionService.ensureBuiltInRolePermissions()` 只 upsert
 * 了 1 个权限码（role:manage_monitor_titles）。
 *
 * 后果（已实测复现）：
 *  - `prisma/seed.ts` 不创建任何权限记录；
 *  - docker-compose 的 migrate 服务只跑 `migrate deploy || db push`，不跑该脚本；
 *  - 于是全新部署后 permissions 表只有 1 行，sys_admin 的角色权限集合为空；
 *  - `GET /admin/users`（要求 user:manage）对 **sys_admin 也返回 403**，
 *    用户管理、班级管理、学生管理等核心后台功能全部不可用。
 *
 * 因此把目录提取到本模块，由 `PermissionService` 在运行期自动补齐，
 * CLI 脚本只作为「手动重算」入口复用同一份定义，避免两处漂移。
 */

export interface PermissionDef {
  code: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

/** 权限定义（58 项） */
export const PERMISSIONS: PermissionDef[] = [
  // 学生管理权限
  { code: 'student:read', name: '查看学生', description: '查看学生信息', resource: 'student', action: 'read' },
  { code: 'student:create', name: '创建学生', description: '创建新学生', resource: 'student', action: 'create' },
  { code: 'student:update', name: '更新学生', description: '更新学生信息', resource: 'student', action: 'update' },
  { code: 'student:delete', name: '删除学生', description: '删除学生', resource: 'student', action: 'delete' },
  { code: 'student:import', name: '导入学生', description: '批量导入学生', resource: 'student', action: 'import' },
  { code: 'student:export', name: '导出学生', description: '导出学生数据', resource: 'student', action: 'export' },
  { code: 'student:preference', name: '修改偏好', description: '修改个人偏好设置', resource: 'student', action: 'preference' },

  // 班级管理权限
  { code: 'class:read', name: '查看班级', description: '查看班级信息', resource: 'class', action: 'read' },
  { code: 'class:create', name: '创建班级', description: '创建新班级', resource: 'class', action: 'create' },
  { code: 'class:update', name: '更新班级', description: '更新班级信息', resource: 'class', action: 'update' },
  { code: 'class:delete', name: '删除班级', description: '删除班级', resource: 'class', action: 'delete' },
  { code: 'class:manage_students', name: '管理班级学生', description: '管理班级学生', resource: 'class', action: 'manage_students' },

  // 预警管理权限
  { code: 'warning:read', name: '查看预警', description: '查看预警列表', resource: 'warning', action: 'read' },
  { code: 'warning:close', name: '关闭预警', description: '关闭预警', resource: 'warning', action: 'close' },
  { code: 'warning:acknowledge', name: '确认预警', description: '确认收到预警', resource: 'warning', action: 'acknowledge' },
  { code: 'warning:manage', name: '管理预警', description: '审批预警相关操作', resource: 'warning', action: 'manage' },

  // 请假 / 申诉管理权限
  { code: 'leave:read', name: '查看请假', description: '查看请假申请', resource: 'leave', action: 'read' },
  { code: 'leave:approve', name: '审批请假', description: '审批请假申请', resource: 'leave', action: 'approve' },
  { code: 'appeal:read', name: '查看申诉', description: '查看申诉工单', resource: 'appeal', action: 'read' },
  { code: 'appeal:handle', name: '处理申诉', description: '处理申诉工单', resource: 'appeal', action: 'handle' },

  // 课程管理权限
  { code: 'course:read', name: '查看课程', description: '查看课程信息', resource: 'course', action: 'read' },
  { code: 'course:create', name: '创建课程', description: '创建新课程', resource: 'course', action: 'create' },
  { code: 'course:update', name: '更新课程', description: '更新课程信息', resource: 'course', action: 'update' },
  { code: 'course:delete', name: '删除课程', description: '删除课程', resource: 'course', action: 'delete' },

  // 课表管理权限
  { code: 'schedule:read', name: '查看课表', description: '查看课表', resource: 'schedule', action: 'read' },
  { code: 'schedule:create', name: '创建课表', description: '创建课表', resource: 'schedule', action: 'create' },
  { code: 'schedule:update', name: '更新课表', description: '更新课表', resource: 'schedule', action: 'update' },
  { code: 'schedule:delete', name: '删除课表', description: '删除课表', resource: 'schedule', action: 'delete' },
  { code: 'schedule:import', name: '导入课表', description: '导入课表', resource: 'schedule', action: 'import' },

  // 签到管理权限
  { code: 'attendance:read', name: '查看签到', description: '查看签到记录', resource: 'attendance', action: 'read' },
  { code: 'attendance:manage', name: '管理签到', description: '管理签到状态', resource: 'attendance', action: 'manage' },
  { code: 'attendance:checkin', name: '执行签到', description: '学生扫码签到', resource: 'attendance', action: 'checkin' },

  // 成绩管理权限
  { code: 'grade:read', name: '查看成绩', description: '查看成绩', resource: 'grade', action: 'read' },
  { code: 'grade:update', name: '更新成绩', description: '修改成绩', resource: 'grade', action: 'update' },
  { code: 'grade:import', name: '导入成绩', description: '导入成绩', resource: 'grade', action: 'import' },

  // 教师管理权限
  { code: 'teacher:read', name: '查看教师', description: '查看教师信息', resource: 'teacher', action: 'read' },
  { code: 'teacher:create', name: '创建教师', description: '创建新教师', resource: 'teacher', action: 'create' },
  { code: 'teacher:update', name: '更新教师', description: '更新教师信息', resource: 'teacher', action: 'update' },
  { code: 'teacher:delete', name: '删除教师', description: '删除教师', resource: 'teacher', action: 'delete' },

  // 规则管理权限
  { code: 'rule:read', name: '查看规则', description: '查看预警规则', resource: 'rule', action: 'read' },
  { code: 'rule:create', name: '创建规则', description: '创建预警规则', resource: 'rule', action: 'create' },
  { code: 'rule:update', name: '更新规则', description: '更新预警规则', resource: 'rule', action: 'update' },
  { code: 'rule:delete', name: '删除规则', description: '删除预警规则', resource: 'rule', action: 'delete' },

  // 用户 / 权限管理权限
  { code: 'user:manage', name: '管理用户', description: '管理用户账号', resource: 'user', action: 'manage' },
  { code: 'role:manage', name: '管理角色', description: '管理角色配置', resource: 'role', action: 'manage' },
  { code: 'role:manage_monitor_titles', name: '管理班干名称', description: '配置班干职位名称选项', resource: 'role', action: 'manage_monitor_titles' },
  { code: 'permission:manage', name: '管理权限', description: '管理权限配置', resource: 'permission', action: 'manage' },
  { code: 'system:config', name: '系统配置', description: '系统配置管理', resource: 'system', action: 'config' },

  // 通知管理权限
  { code: 'notification:read', name: '查看通知', description: '查看通知记录', resource: 'notification', action: 'read' },
  { code: 'notification:send', name: '发送通知', description: '发送通知', resource: 'notification', action: 'send' },
  { code: 'notification:config', name: '配置通知', description: '配置通知策略', resource: 'notification', action: 'config' },

  // 报表 / 统计权限
  { code: 'report:read', name: '查看报表', description: '查看报表', resource: 'report', action: 'read' },
  { code: 'report:export', name: '导出报表', description: '导出报表', resource: 'report', action: 'export' },
  { code: 'stats:view', name: '查看统计', description: '查看系统统计数据', resource: 'stats', action: 'view' },

  // 审计日志权限
  { code: 'audit:view', name: '查看审计日志', description: '查看操作日志、消息记录、安全事件', resource: 'audit', action: 'view' },
  { code: 'audit:export', name: '导出审计日志', description: '导出审计日志', resource: 'audit', action: 'export' },

  // 系统配置权限
  { code: 'config:view', name: '查看配置', description: '查看系统配置', resource: 'config', action: 'view' },
  { code: 'config:update', name: '更新配置', description: '更新系统配置', resource: 'config', action: 'update' },
];

/**
 * 角色 → 权限映射（7 个内置角色）
 *
 * ⚠️ 注意：`sys_admin` 在 PermissionService 中有额外的短路逻辑
 * （直接授予 permissions 表的全部权限码），因此本映射里 sys_admin 的列表
 * 主要用于「权限集合自省」与前端菜单渲染。
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  student: [
    'student:read', 'student:preference', 'warning:read', 'warning:acknowledge',
    'leave:read', 'appeal:read', 'attendance:checkin', 'schedule:read', 'grade:read',
  ],
  class_monitor: [
    'student:read', 'student:preference', 'warning:read', 'warning:acknowledge',
    'leave:read', 'appeal:read', 'attendance:checkin', 'schedule:read', 'grade:read',
    'class:read', 'notification:send',
  ],
  head_teacher: [
    'student:read', 'student:update', 'class:read', 'class:manage_students',
    'warning:read', 'warning:close', 'warning:manage',
    'leave:read', 'leave:approve', 'appeal:read', 'appeal:handle',
    'attendance:read', 'attendance:manage', 'schedule:read',
    'report:read', 'report:export', 'stats:view',
  ],
  student_admin: [
    'student:read', 'student:create', 'student:update', 'student:import', 'student:export',
    'class:read', 'warning:read', 'warning:close', 'warning:manage',
    'leave:read', 'leave:approve', 'appeal:read', 'appeal:handle',
    'rule:read', 'rule:create', 'rule:update', 'rule:delete',
    'notification:read', 'notification:config',
    'report:read', 'report:export', 'stats:view',
  ],
  teaching_admin: [
    'student:read', 'student:export',
    'class:read', 'course:read', 'course:create', 'course:update', 'course:delete',
    'schedule:read', 'schedule:create', 'schedule:update', 'schedule:delete', 'schedule:import',
    'grade:read', 'grade:update', 'grade:import',
    'report:read', 'report:export', 'stats:view',
  ],
  vice_dean: [
    'student:read', 'class:read', 'warning:read', 'leave:read',
    'appeal:read', 'appeal:handle', 'rule:read', 'report:read', 'report:export', 'stats:view',
  ],
  sys_admin: [
    'student:read', 'student:create', 'student:update', 'student:delete', 'student:import', 'student:export', 'student:preference',
    'class:read', 'class:create', 'class:update', 'class:delete', 'class:manage_students',
    'warning:read', 'warning:close', 'warning:acknowledge', 'warning:manage',
    'leave:read', 'leave:approve', 'appeal:read', 'appeal:handle',
    'course:read', 'course:create', 'course:update', 'course:delete',
    'schedule:read', 'schedule:create', 'schedule:update', 'schedule:delete', 'schedule:import',
    'attendance:read', 'attendance:manage', 'attendance:checkin',
    'grade:read', 'grade:update', 'grade:import',
    'teacher:read', 'teacher:create', 'teacher:update', 'teacher:delete',
    'rule:read', 'rule:create', 'rule:update', 'rule:delete',
    'user:manage', 'role:manage', 'role:manage_monitor_titles', 'permission:manage', 'system:config',
    'notification:read', 'notification:send', 'notification:config',
    'report:read', 'report:export', 'stats:view',
    'audit:view', 'audit:export',
    'config:view', 'config:update',
  ],
};

/**
 * 代码中被 @Permissions() 引用、但历史上未登记进目录的权限码
 * （P1-10 孤儿权限码：审计删除、文件下载对除 sys_admin 外的角色永久 403）。
 * 这里显式补齐，使其可被分配。
 */
export const ORPHAN_PERMISSIONS: PermissionDef[] = [
  { code: 'audit:delete', name: '删除审计日志', description: '删除审计日志记录', resource: 'audit', action: 'delete' },
  { code: 'file:download', name: '下载文件', description: '下载系统文件与导出结果', resource: 'file', action: 'download' },
];

/** 完整目录 = 常规权限 + 历史遗漏权限 */
export const PERMISSION_CATALOG: PermissionDef[] = [...PERMISSIONS, ...ORPHAN_PERMISSIONS];
