# 角色 × 菜单 × 页面 覆盖核对表（自动生成）

> 生成脚本：`scripts/audit-role-menus.js`

> 生成时间：2026-09-12T04:23:04.985Z

> ⚠️ **本表为源码走查结果，未做真实浏览器点击**（本机无浏览器环境）。
> 按钮列为源码中 `@click` / `<el-button>` 的**存在性**统计，非"可点击验证"。

## 汇总

| 指标 | 数值 |
| --- | --- |
| 角色数（roleMenuConfig） | 9 |
| 路由总数（router.ts） | 53 |
| 角色-菜单条目总数 | 59 |
| 唯一菜单路径数 | 42 |
| 菜单指向未注册路由 | 0 |
| 组件文件缺失 | 0 |
| 死页面（已注册但无菜单可达） | 9 |

## ⚠️ 死页面（已注册但任何角色菜单都不可达）

- / (./pages/student/BindClass.vue)
- /class-notifications (./pages/class-monitor/ClassNotifications.vue)
- /class-members (./pages/class-monitor/ClassMembers.vue)
- /student-admin-bind-org (./pages/student-admin/BindOrg.vue)
- /college-stats-1 (./pages/student-admin/CollegeStats1.vue)
- /student-warnings (./pages/StudentWarnings.vue)
- /users (./pages/Users.vue)
- /roles (./pages/system/RoleManagement.vue)
- /course-manage (./pages/CourseManage.vue)

## 按角色展开

### 学生端（`student`）— 6 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 班级通知 | `/my-notifications` | pages/student/MyNotifications.vue | 2 | OK |
| 本班课表 | `/my-schedules` | — | 0 | 组件文件未解析 |
| 我的预警 | `/my-warnings` | pages/student/MyWarnings.vue | 4 | OK |
| 请假申请 | `/my-leaves` | pages/student/MyLeaves.vue | 8 | OK |
| 申诉记录 | `/my-appeals` | pages/student/MyAppeals.vue | 8 | OK |
| 个人信息 | `/my-profile` | pages/student/MyProfile.vue | 15 | OK |

### 班干部端（`class_monitor`）— 9 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 班级通知 | `/my-notifications` | pages/student/MyNotifications.vue | 2 | OK |
| 本班课表 | `/my-schedules` | — | 0 | 组件文件未解析 |
| 我的预警 | `/my-warnings` | pages/student/MyWarnings.vue | 4 | OK |
| 请假申请 | `/my-leaves` | pages/student/MyLeaves.vue | 8 | OK |
| 申诉记录 | `/my-appeals` | pages/student/MyAppeals.vue | 8 | OK |
| 个人信息 | `/my-profile` | pages/student/MyProfile.vue | 15 | OK |
| 班级概览 | `/class-overview` | pages/class-monitor/ClassOverview.vue | 2 | OK |
| 发布通知 | `/class-notifications-publish` | pages/class-monitor/ClassNotifications.vue | 2 | OK |
| 班级预警 | `/class-warnings` | pages/class-monitor/ClassWarnings.vue | 0 | OK |

### 班主任端（`head_teacher`）— 12 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 绑定班级 | `/teacher-bind-class` | pages/teacher/BindClass.vue | 2 | OK |
| 绑定课程 | `/teacher-bind-courses` | pages/teacher/BindCourses.vue | 3 | OK |
| 本班概览 | `/head-teacher-class-overview` | pages/teacher/ClassOverview.vue | 6 | OK |
| 签到管理 | `/teacher-attendance` | pages/teacher/TeacherAttendance.vue | 26 | OK |
| 课表查询 | `/my-schedules` | — | 0 | 组件文件未解析 |
| 本班学生 | `/students` | — | 0 | 组件文件未解析 |
| 本班预警 | `/warnings` | — | 0 | 组件文件未解析 |
| 高风险干预 | `/intervention-cases` | pages/InterventionCases.vue | 19 | OK |
| 本班审批 | `/approvals` | — | 0 | 组件文件未解析 |
| 请假名单 | `/head-teacher-leaves` | pages/teacher/HeadTeacherLeaves.vue | 2 | OK |
| 本班导出 | `/class-export` | pages/teacher/ClassExport.vue | 4 | OK |
| 个人信息 | `/teacher-profile` | pages/teacher/TeacherProfile.vue | 15 | OK |

### 学工管理员端（`student_admin`）— 5 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 学院预警统计 | `/college-dashboard` | pages/student-admin/CollegeStats1.vue | 4 | OK |
| 学院统计-2 | `/college-stats-2` | pages/student-admin/CollegeStats2.vue | 0 | OK |
| 高风险干预 | `/intervention-cases` | pages/InterventionCases.vue | 19 | OK |
| 规则覆盖 | `/rules-override` | pages/student-admin/RulesOverride.vue | 4 | OK |
| 通知策略 | `/notification-strategy` | pages/student-admin/NotificationStrategy.vue | 4 | OK |

### 教务管理员端（`dean`）— 0 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |

### 教务管理员端（`teaching_admin`）— 0 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |

### 教学副院长端（`vice_dean`）— 1 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 审批中心 | `/approvals` | — | 0 | 组件文件未解析 |

### 系统管理员端（`sys_admin`）— 21 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 预警列表 | `/warnings` | — | 0 | 组件文件未解析 |
| 高风险干预 | `/intervention-cases` | pages/InterventionCases.vue | 19 | OK |
| 预警统计-1 | `/system-stats` | pages/system/SystemStats.vue | 0 | OK |
| 预警统计-2 | `/system-stats-2` | pages/system/SystemStats2.vue | 0 | OK |
| 规则配置 | `/rules` | — | 0 | 组件文件未解析 |
| 学院管理 | `/orgs` | pages/Orgs.vue | 18 | OK |
| 班级管理 | `/classes` | — | 0 | 组件文件未解析 |
| 教师管理 | `/teachers` | pages/Teachers.vue | 16 | OK |
| 学生管理 | `/students` | — | 0 | 组件文件未解析 |
| 课程与开课班管理 | `/course-classes` | — | 0 | 组件文件未解析 |
| 课表管理 | `/schedules` | — | 0 | 组件文件未解析 |
| 签到明细 | `/attendance` | — | 0 | 组件文件未解析 |
| 审批中心 | `/approvals` | — | 0 | 组件文件未解析 |
| 审计中心 | `/audit` | — | 0 | 组件文件未解析 |
| 报表导出 | `/reports` | — | 0 | 组件文件未解析 |
| 反馈中心 | `/feedback-center` | — | 0 | 组件文件未解析 |
| 系统管理 | `/system-management` | — | 0 | 组件文件未解析 |
| 全校统计 | `/school-stats` | pages/teaching-admin/SchoolStats.vue | 2 | OK |
| 学期起始设置 | `/semester-settings` | pages/teaching-admin/SemesterSettings.vue | 4 | OK |
| 成绩管理 | `/grades-manage` | pages/teaching-admin/GradesManage.vue | 30 | OK |
| 学籍变更 | `/student-profile-manage` | pages/teaching-admin/StudentProfileManage.vue | 8 | OK |

### 教师端（`teacher`）— 5 个菜单

| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |
| --- | --- | --- | --- | --- |
| 绑定学院 | `/teacher-bind-org` | pages/teacher/BindOrg.vue | 2 | OK |
| 绑定课程 | `/teacher-bind-courses` | pages/teacher/BindCourses.vue | 3 | OK |
| 任教课表 | `/my-schedules` | — | 0 | 组件文件未解析 |
| 签到管理 | `/teacher-attendance` | pages/teacher/TeacherAttendance.vue | 26 | OK |
| 个人信息 | `/teacher-profile` | pages/teacher/TeacherProfile.vue | 15 | OK |
