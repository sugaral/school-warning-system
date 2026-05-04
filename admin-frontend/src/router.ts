import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import {
  getHeadTeacherBoundState,
  getStudentAdminBoundState,
  getStudentBoundState,
  getTeacherBindingState,
} from './lib/binding';
import { roleMenuConfig, type MenuItem } from './config/menus';
import { clearDynamicImportReloadGuard, isDynamicImportError, reloadForDynamicImportError } from './lib/dynamic-import-recovery';
import StudentBindClassPage from './pages/student/BindClass.vue';
import TeacherBindClassPage from './pages/teacher/BindClass.vue';

const Login = () => import('./pages/Login.vue');
const Register = () => import('./pages/Register.vue');
const Dashboard = () => import('./pages/Dashboard.vue');
const Warnings = () => import('./pages/Warnings.vue');
const Approvals = () => import('./pages/Approvals.vue');
const Attendance = () => import('./pages/Attendance.vue');
const Rules = () => import('./pages/Rules.vue');
const Students = () => import('./pages/Students.vue');
const Classes = () => import('./pages/Classes.vue');
const CourseClasses = () => import('./pages/CourseClasses.vue');
const Schedules = () => import('./pages/Schedules.vue');
const MySchedules = () => import('./pages/MySchedules.vue');
const SystemManagement = () => import('./pages/SystemManagement.vue');
const Reports = () => import('./pages/Reports.vue');
const Audit = () => import('./pages/Audit.vue');
const FeedbackCenter = () => import('./pages/system/FeedbackCenter.vue');

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: Login },
  { path: '/register', name: 'register', component: Register },
  {
    path: '/',
    component: Dashboard,
    children: [
      { path: 'bind-class', name: 'bind-class', component: StudentBindClassPage },
      { path: 'my-notifications', name: 'my-notifications', component: () => import('./pages/student/MyNotifications.vue') },
      { path: 'my-schedules', name: 'my-schedules', component: MySchedules },
      { path: 'my-warnings', name: 'my-warnings', component: () => import('./pages/student/MyWarnings.vue') },
      { path: 'my-leaves', name: 'my-leaves', component: () => import('./pages/student/MyLeaves.vue') },
      { path: 'my-appeals', name: 'my-appeals', component: () => import('./pages/student/MyAppeals.vue') },
      { path: 'my-profile', name: 'my-profile', component: () => import('./pages/student/MyProfile.vue') },

      { path: 'class-overview', name: 'class-overview', component: () => import('./pages/class-monitor/ClassOverview.vue'), meta: { keepAlive: true } },
      { path: 'class-notifications', name: 'class-notifications', component: () => import('./pages/class-monitor/ClassNotifications.vue') },
      { path: 'class-notifications-publish', name: 'class-notifications-publish', component: () => import('./pages/class-monitor/ClassNotifications.vue') },
      { path: 'class-warnings', name: 'class-warnings', component: () => import('./pages/class-monitor/ClassWarnings.vue') },
      { path: 'class-members', name: 'class-members', component: () => import('./pages/class-monitor/ClassMembers.vue') },

      { path: 'head-teacher-class-overview', name: 'class-overview-head-teacher', component: () => import('./pages/teacher/ClassOverview.vue') },
      { path: 'class-export', name: 'class-export', component: () => import('./pages/teacher/ClassExport.vue') },
      { path: 'head-teacher-leaves', name: 'head-teacher-leaves', component: () => import('./pages/teacher/HeadTeacherLeaves.vue') },
      { path: 'teacher-bind-class', name: 'teacher-bind-class', component: TeacherBindClassPage },
      { path: 'intervention-cases', name: 'intervention-cases', component: () => import('./pages/InterventionCases.vue') },

      { path: 'teacher-bind-org', name: 'teacher-bind-org', component: () => import('./pages/teacher/BindOrg.vue') },
      { path: 'teacher-bind-courses', name: 'teacher-bind-courses', component: () => import('./pages/teacher/BindCourses.vue') },
      { path: 'teacher-attendance', name: 'teacher-attendance', component: () => import('./pages/teacher/TeacherAttendance.vue') },
      { path: 'teacher-profile', name: 'teacher-profile', component: () => import('./pages/teacher/TeacherProfile.vue') },

      { path: 'student-admin-bind-org', name: 'student-admin-bind-org', component: () => import('./pages/student-admin/BindOrg.vue') },
      { path: 'college-dashboard', name: 'college-dashboard', component: () => import('./pages/student-admin/CollegeStats1.vue') },
      { path: 'college-stats-1', name: 'college-stats-1', component: () => import('./pages/student-admin/CollegeStats1.vue') },
      { path: 'college-stats-2', name: 'college-stats-2', component: () => import('./pages/student-admin/CollegeStats2.vue') },
      { path: 'rules-override', name: 'rules-override', component: () => import('./pages/student-admin/RulesOverride.vue') },
      { path: 'notification-strategy', name: 'notification-strategy', component: () => import('./pages/student-admin/NotificationStrategy.vue') },

      { path: 'school-stats', name: 'school-stats', component: () => import('./pages/teaching-admin/SchoolStats.vue') },
      { path: 'semester-settings', name: 'semester-settings', component: () => import('./pages/teaching-admin/SemesterSettings.vue') },
      { path: 'grades-manage', name: 'grades-manage', component: () => import('./pages/teaching-admin/GradesManage.vue') },
      { path: 'student-profile-manage', name: 'student-profile-manage', component: () => import('./pages/teaching-admin/StudentProfileManage.vue') },

      { path: 'special-approvals', name: 'special-approvals', redirect: '/approvals' },

      { path: '', redirect: '/warnings' },
      { path: 'warnings', name: 'warnings', component: Warnings, meta: { keepAlive: true } },
      { path: 'system-stats', name: 'system-stats', component: () => import('./pages/system/SystemStats.vue') },
      { path: 'system-stats-2', name: 'system-stats-2', component: () => import('./pages/system/SystemStats2.vue') },
      { path: 'approvals', name: 'approvals', component: Approvals },
      { path: 'course-classes', name: 'course-classes', component: CourseClasses },
      { path: 'schedules', name: 'schedules', component: Schedules },
      { path: 'attendance', name: 'attendance', component: Attendance, meta: { keepAlive: true } },
      { path: 'rules', name: 'rules', component: Rules },
      { path: 'students', name: 'students', component: Students, meta: { keepAlive: true } },
      { path: 'student-warnings', name: 'student-warnings', component: () => import('./pages/StudentWarnings.vue') },
      { path: 'orgs', name: 'orgs', component: () => import('./pages/Orgs.vue') },
      { path: 'teachers', name: 'teachers', component: () => import('./pages/Teachers.vue') },
      { path: 'classes', name: 'classes', component: Classes, meta: { keepAlive: true } },
      { path: 'users', name: 'users', component: SystemManagement },
      { path: 'system-management', name: 'system-management', component: SystemManagement },
      { path: 'roles', name: 'roles', component: () => import('./pages/system/RoleManagement.vue') },
      {
        path: 'permissions',
        name: 'permissions',
        redirect: { path: '/system-management', query: { tab: 'permissions' } },
      },
      {
        path: 'system-config',
        name: 'system-config',
        redirect: { path: '/system-management', query: { tab: 'config' } },
      },
      {
        path: 'two-factor-management',
        name: 'two-factor-management',
        redirect: { path: '/system-management', query: { tab: 'two-factor' } },
      },
      { path: 'course-manage', name: 'course-manage', component: () => import('./pages/CourseManage.vue') },
      { path: 'reports', name: 'reports', component: Reports, meta: { keepAlive: true } },
      { path: 'audit', name: 'audit', component: Audit, meta: { keepAlive: true } },
      { path: 'feedback-center', name: 'feedback-center', component: FeedbackCenter },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.onError((error, to) => {
  if (isDynamicImportError(error)) {
    reloadForDynamicImportError(to?.fullPath);
    return;
  }

  console.error('路由加载失败:', error);
});

router.afterEach(() => {
  clearDynamicImportReloadGuard();
});

const isStudentBound = () => getStudentBoundState() === true;
const isHeadTeacherBound = () => getHeadTeacherBoundState() === true;
const isStudentAdminBound = () => getStudentAdminBoundState() === true;
const PUBLIC_PATHS = new Set(['/login', '/register']);
const PATH_ACCESS_EQUIVALENTS: Record<string, string> = {
  '/users': '/system-management',
  '/roles': '/system-management',
  '/permissions': '/system-management',
  '/system-config': '/system-management',
  '/two-factor-management': '/system-management',
  '/special-approvals': '/approvals',
  '/college-stats-1': '/college-dashboard',
  '/class-notifications': '/class-notifications-publish',
  '/student-warnings': '/warnings',
};
const ROLE_EXTRA_ALLOWED_PATHS: Record<string, string[]> = {
  student: ['/bind-class'],
  class_monitor: ['/bind-class', '/class-notifications'],
  head_teacher: ['/teacher-bind-class', '/teacher-bind-courses'],
  student_admin: ['/student-admin-bind-org', '/college-stats-1'],
  teacher: ['/teacher-bind-org', '/teacher-bind-courses'],
};

const flattenMenuPaths = (menus: MenuItem[]) => {
  const result = new Set<string>();
  const walk = (items: MenuItem[]) => {
    items.forEach((item) => {
      if (item.path.startsWith('/')) {
        result.add(item.path);
      }
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children);
      }
    });
  };
  walk(menus);
  return [...result];
};

const getRolesFull = () => {
  const raw = localStorage.getItem('admin_roles_full');
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getPrimaryRole = (rolesFull: any[]) => {
  if (rolesFull.find((role) => role.role === 'class_monitor')) return 'class_monitor';
  if (rolesFull.find((role) => role.role === 'student')) return 'student';
  if (rolesFull.find((role) => role.role === 'head_teacher')) return 'head_teacher';
  if (rolesFull.find((role) => role.role === 'student_admin')) return 'student_admin';
  if (rolesFull.find((role) => role.role === 'vice_dean')) return 'vice_dean';
  if (rolesFull.find((role) => role.role === 'dean' || role.role === 'teaching_admin')) return 'teaching_admin';
  if (rolesFull.find((role) => role.role === 'sys_admin')) return 'sys_admin';
  if (rolesFull.find((role) => role.role === 'teacher')) return 'teacher';
  return '';
};

const getComparableProtectedPath = (path: string) => PATH_ACCESS_EQUIVALENTS[path] || path;

const getAllowedPathSet = (rolesFull: any[]) => {
  const allowed = new Set<string>();

  rolesFull.forEach((item: any) => {
    const roleCode = String(item?.role || '').trim();
    if (!roleCode) {
      return;
    }

    const menuConfig = roleMenuConfig.find((config) => config.role === roleCode);
    flattenMenuPaths(menuConfig?.menus || []).forEach((path) => {
      allowed.add(path);
    });

    (ROLE_EXTRA_ALLOWED_PATHS[roleCode] || []).forEach((path) => {
      allowed.add(path);
    });
  });

  return allowed;
};

const isPathAllowedForRoles = (path: string, rolesFull: any[]) => {
  if (PUBLIC_PATHS.has(path) || path === '/') {
    return true;
  }

  const allowed = getAllowedPathSet(rolesFull);
  if (allowed.has(path)) {
    return true;
  }

  const comparablePath = getComparableProtectedPath(path);
  return allowed.has(comparablePath);
};

const getStudentHomePath = (role: 'student' | 'class_monitor') => {
  if (!isStudentBound()) {
    return '/bind-class';
  }

  return role === 'class_monitor' ? '/class-overview' : '/my-warnings';
};

const getDefaultPathForRole = (role: string) => {
  if (role === 'class_monitor') {
    return getStudentHomePath('class_monitor');
  }
  if (role === 'student') {
    return getStudentHomePath('student');
  }
  if (role === 'head_teacher') {
    if (!isHeadTeacherBound()) {
      return '/teacher-bind-class';
    }
    const teacherBinding = getTeacherBindingState();
    if (teacherBinding.hasBoundCourses !== true) {
      return '/teacher-bind-courses';
    }
    return '/head-teacher-class-overview';
  }
  if (role === 'student_admin') {
    return isStudentAdminBound() ? '/college-dashboard' : '/student-admin-bind-org';
  }
  if (role === 'teacher') {
    const teacherBinding = getTeacherBindingState();
    if (teacherBinding.hasBoundOrg !== true) {
      return '/teacher-bind-org';
    }
    if (teacherBinding.hasBoundCourses !== true) {
      return '/teacher-bind-courses';
    }
    return '/teacher-attendance';
  }
  if (role === 'vice_dean') {
    return '/approvals';
  }
  if (role === 'teaching_admin') {
    return '/school-stats';
  }
  if (role === 'sys_admin') {
    return '/warnings';
  }
  return '/warnings';
};

const getBindingRedirect = (toPath: string, rolesFull: any[]) => {
  const primaryRole = getPrimaryRole(rolesFull);
  if (!primaryRole) {
    return null;
  }

  if (primaryRole === 'class_monitor' || primaryRole === 'student') {
    const homePath = getStudentHomePath(primaryRole as 'class_monitor' | 'student');
    if (!isStudentBound() && toPath !== '/bind-class') {
      return '/bind-class';
    }
    if (isStudentBound() && toPath === '/bind-class') {
      return homePath;
    }
    return null;
  }

  if (primaryRole === 'head_teacher') {
    if (!isHeadTeacherBound() && toPath !== '/teacher-bind-class') {
      return '/teacher-bind-class';
    }
    if (isHeadTeacherBound()) {
      const teacherBinding = getTeacherBindingState();
      if (
        teacherBinding.hasBoundCourses !== true
        && toPath !== '/teacher-bind-class'
        && toPath !== '/teacher-bind-courses'
      ) {
        return '/teacher-bind-courses';
      }
    }
    return null;
  }

  if (primaryRole === 'student_admin') {
    if (!isStudentAdminBound() && toPath !== '/student-admin-bind-org') {
      return '/student-admin-bind-org';
    }
    if (isStudentAdminBound() && toPath === '/student-admin-bind-org') {
      return '/college-dashboard';
    }
    return null;
  }

  if (primaryRole === 'teacher') {
    const teacherBinding = getTeacherBindingState();
    if (teacherBinding.hasBoundOrg !== true && toPath !== '/teacher-bind-org') {
      return '/teacher-bind-org';
    }
    if (teacherBinding.hasBoundOrg === true && teacherBinding.hasBoundCourses !== true) {
      if (toPath !== '/teacher-bind-org' && toPath !== '/teacher-bind-courses') {
        return '/teacher-bind-courses';
      }
    }
    if (teacherBinding.hasBoundOrg === true && toPath === '/teacher-bind-org') {
      return teacherBinding.hasBoundCourses === true ? '/teacher-attendance' : '/teacher-bind-courses';
    }
  }

  return null;
};

const getRestrictedRedirect = (toPath: string, rolesFull: any[]) => {
  const primaryRole = getPrimaryRole(rolesFull);
  const roleCodes = rolesFull.map((item: any) => item.role);

  if (toPath === '/roles' && !roleCodes.includes('sys_admin')) {
    return getDefaultPathForRole(primaryRole || '');
  }

  if (
    primaryRole === 'head_teacher'
    && ['/system-stats', '/system-stats-2', '/roles'].includes(toPath)
  ) {
    return isHeadTeacherBound() ? '/head-teacher-class-overview' : '/teacher-bind-class';
  }

  return null;
};

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('admin_token');

  if (!PUBLIC_PATHS.has(to.path) && !token) {
    next('/login');
    return;
  }

  if (token && PUBLIC_PATHS.has(to.path)) {
    next('/');
    return;
  }

  if (token) {
    const rolesFull = getRolesFull();
    const bindingRedirect = getBindingRedirect(to.path, rolesFull);
    if (bindingRedirect && bindingRedirect !== to.path) {
      next(bindingRedirect);
      return;
    }

    if (!isPathAllowedForRoles(to.path, rolesFull)) {
      next(getDefaultPathForRole(getPrimaryRole(rolesFull)));
      return;
    }

    const restrictedRedirect = getRestrictedRedirect(to.path, rolesFull);
    if (restrictedRedirect && restrictedRedirect !== to.path) {
      next(restrictedRedirect);
      return;
    }
  }

  if (to.path === '/') {
    const rolesFull = getRolesFull();
    if (rolesFull.length > 0) {
      next(getDefaultPathForRole(getPrimaryRole(rolesFull)));
      return;
    }

    next('/warnings');
    return;
  }

  next();
});
