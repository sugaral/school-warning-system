export interface MenuItem {
  path: string;
  name: string;
  icon?: string;
  children?: MenuItem[];
}

export interface RoleMenuConfig {
  role: string;
  title: string;
  menus: MenuItem[];
}

const teachingAdminMenus: MenuItem[] = [
  { path: '/school-stats', name: '全校统计' },
  { path: '/semester-settings', name: '学期起始设置' },
  { path: '/course-classes', name: '课程与开课班管理' },
  { path: '/schedules', name: '课表管理' },
  { path: '/approvals', name: '审批中心' },
  { path: '/grades-manage', name: '成绩管理' },
  { path: '/student-profile-manage', name: '学籍变更' },
  { path: '/students', name: '学生管理' },
];

export const roleMenuConfig: RoleMenuConfig[] = [
  {
    role: 'student',
    title: '学生端',
    menus: [
      { path: '/my-notifications', name: '班级通知' },
      { path: '/my-schedules', name: '本班课表' },
      { path: '/my-warnings', name: '我的预警' },
      { path: '/my-leaves', name: '请假申请' },
      { path: '/my-appeals', name: '申诉记录' },
      { path: '/my-profile', name: '个人信息' },
    ],
  },
  {
    role: 'class_monitor',
    title: '班干部端',
    menus: [
      { path: '/my-notifications', name: '班级通知' },
      { path: '/my-schedules', name: '本班课表' },
      { path: '/my-warnings', name: '我的预警' },
      { path: '/my-leaves', name: '请假申请' },
      { path: '/my-appeals', name: '申诉记录' },
      { path: '/my-profile', name: '个人信息' },
      {
        path: '/class-monitor',
        name: '班级事务',
        children: [
          { path: '/class-overview', name: '班级概览' },
          { path: '/class-notifications-publish', name: '发布通知' },
          { path: '/class-warnings', name: '班级预警' },
        ],
      },
    ],
  },
  {
    role: 'head_teacher',
    title: '班主任端',
    menus: [
      { path: '/teacher-bind-class', name: '绑定班级' },
      { path: '/teacher-bind-courses', name: '绑定课程' },
      { path: '/head-teacher-class-overview', name: '本班概览' },
      { path: '/teacher-attendance', name: '签到管理' },
      { path: '/my-schedules', name: '课表查询' },
      { path: '/students', name: '本班学生' },
      { path: '/warnings', name: '本班预警' },
      { path: '/intervention-cases', name: '高风险干预' },
      { path: '/approvals', name: '本班审批' },
      { path: '/head-teacher-leaves', name: '请假名单' },
      { path: '/class-export', name: '本班导出' },
      { path: '/teacher-profile', name: '个人信息' },
    ],
  },
  {
    role: 'student_admin',
    title: '学工管理员端',
    menus: [
      { path: '/college-dashboard', name: '学院预警统计' },
      { path: '/college-stats-2', name: '学院统计-2' },
      { path: '/intervention-cases', name: '高风险干预' },
      { path: '/rules-override', name: '规则覆盖' },
      { path: '/notification-strategy', name: '通知策略' },
    ],
  },
  {
    role: 'dean',
    title: '教务管理员端',
    menus: teachingAdminMenus,
  },
  {
    role: 'teaching_admin',
    title: '教务管理员端',
    menus: teachingAdminMenus,
  },
  {
    role: 'vice_dean',
    title: '教学副院长端',
    menus: [{ path: '/approvals', name: '审批中心' }],
  },
  {
    role: 'sys_admin',
    title: '系统管理员端',
    menus: [
      {
        path: 'warning',
        name: '预警中心',
        children: [
          { path: '/warnings', name: '预警列表' },
          { path: '/intervention-cases', name: '高风险干预' },
          { path: '/system-stats', name: '预警统计-1' },
          { path: '/system-stats-2', name: '预警统计-2' },
          { path: '/rules', name: '规则配置' },
        ],
      },
      {
        path: 'org',
        name: '组织管理',
        children: [
          { path: '/orgs', name: '学院管理' },
          { path: '/classes', name: '班级管理' },
          { path: '/teachers', name: '教师管理' },
          { path: '/students', name: '学生管理' },
        ],
      },
      {
        path: 'course',
        name: '课程课次',
        children: [
          { path: '/course-classes', name: '课程与开课班管理' },
          { path: '/schedules', name: '课表管理' },
          { path: '/attendance', name: '签到明细' },
        ],
      },
      {
        path: 'processing',
        name: '处理中心',
        children: [
          { path: '/approvals', name: '审批中心' },
          { path: '/audit', name: '审计中心' },
        ],
      },
      {
        path: 'system-ops',
        name: '系统操作中心',
        children: [
          { path: '/reports', name: '报表导出' },
          { path: '/feedback-center', name: '反馈中心' },
          { path: '/system-management', name: '系统管理' },
        ],
      },
      {
        path: 'teaching',
        name: '教务管理',
        children: [
          { path: '/school-stats', name: '全校统计' },
          { path: '/semester-settings', name: '学期起始设置' },
          { path: '/grades-manage', name: '成绩管理' },
          { path: '/student-profile-manage', name: '学籍变更' },
        ],
      },
    ],
  },
  {
    role: 'teacher',
    title: '教师端',
    menus: [
      { path: '/teacher-bind-org', name: '绑定学院' },
      { path: '/teacher-bind-courses', name: '绑定课程' },
      { path: '/my-schedules', name: '任教课表' },
      { path: '/teacher-attendance', name: '签到管理' },
      { path: '/teacher-profile', name: '个人信息' },
    ],
  },
];

export function getMenuByRole(role: string): RoleMenuConfig | undefined {
  return roleMenuConfig.find((config) => config.role === role);
}

export function getDefaultPathByRole(role: string): string {
  const config = getMenuByRole(role);
  if (config && config.menus.length > 0) {
    return config.menus[0].path;
  }
  return '/warnings';
}
