# 学业预警系统（warnsys）全量融入小诺（Snowy v3.0.0）超级详细迁移与开发计划

> **文档路径**：`C:\Users\WS\Desktop\Snowy-master\docs\WARNSYS_SNOWY_MIGRATION_PLAN.md`
> **源系统路径**：`c:\Users\WS\Desktop\school-warning-system-master`（NestJS + Prisma + MySQL `warnsys` + Vue3/ElementPlus + 微信小程序）
> **目标底座路径**：`C:\Users\WS\Desktop\Snowy-master`（Snowy v3.0.0：Java 17 + Spring Boot 3.5.16 + MyBatis-Plus 3.5.9 + Sa-Token 1.44.0 + Ant Design Vue 4）
> **计划制定时间**：2026-11-25
> **当前总状态**：`[✔] 全量迁移已完成（M1 ~ M5 进度 100%，全链路安全渗透验收通过，部署割接手册已交付）`

---

## 一、全局进度总览（Milestone Dashboard）

| 里程碑 | 阶段名称 | 核心目标 | 计划工作量 | 状态 | 进度 |
|---|---|---|---|---|---|
| **M1** | **底座初始化 + 数据库融合 + 全量历史数据迁移** | 创建独立 `snowy` 库、导入小诺基础表、新建 33 张 `BIZ_*` 业务表 + 1 张映射表、初始化角色/字典/配置/任务、全量迁移 `warnsys` 38 张表数据、执行 SM3/SM4 国密加密标准化、校验行数与外键完整性、完成 Snowy 本地配置及 Maven 编译启动与在线代码生成器表识别测试 | 已完成 | `DONE` | `100%` |
| **M2** | **16 个基础档案与台账模块（Snowy 在线开发 + 六件套落地）** | 用小诺代码生成器规范（`snowy-plugin-biz` + Ant Design Vue）落地专业、班级、学生档案、课程、开课班、课表、教师绑定、校历排除、预警规则、消息模板、班级公告、公告已读、成绩、请假、补录、申诉/变更单，并配置 `SYS_RESOURCE` 菜单/按钮权限与数据范围 | 已完成 | `DONE` | `100%` |
| **M3** | **5 大核心业务引擎迁移至 `snowy-plugin-biz`** | 1. 课堂动态轮换二维码签到与自动开结课（`DevJob`）；2. 学业预警计算引擎（规则/排除/请假豁免/双表状态/快照/汇总/高风险干预工单）；3. 多角色绑定与审批联动（请假/补录/申诉回写重算、副院长特批）；4. 异步通知队列与 EasyExcel 报表导出；5. 校/院/班三视角 ECharts 统计大屏 | 已完成 | `DONE` | `100%` |
| **M4** | **微信小程序（`miniprogram`）全量对接小诺 C 端** | 在 `snowy-plugin-biz` 新增 `/client/c/warnsys/**`（`StpClientUtil` 隔离）；保持小程序 UI 零改动，仅改造 `request.js`/`config.js`/`smCrypto.js` 接入小诺 C 端 Token 与国密 **SM2 加密传输** | 已完成 | `DONE` | `100%` |
| **M5** | **最终割接校验与全链路安全渗透验收** | B/C 端双向隔离（401）、SM2/SM3/SM4 国密核验、跨院横向越权与纵向提权（403）阻断、前后端按钮权限对齐、零差异复核与部署割接手册交付 | 已完成 | `DONE` | `100%` |

---

## 二、安全隐患根治对照矩阵（为什么要融入小诺）

| 原系统安全扫描暴露的问题 | 小诺（Snowy v3.0.0）底座的根治机制 | 本次迁移落地强化项 |
|---|---|---|
| **P0-1：学生 Token 可调用部分管理端 API（无端隔离）** | B 端教职工/管理员走 `SYS_USER` + `StpUtil`；C 端学生走 `CLIENT_USER` + `StpClientUtil`（`/auth/c/**`、`/client/c/**`），两套会话前缀与校验体系物理隔离 | `GlobalConfigure` 强制拦截所有 `/biz/**` 走 `StpUtil`，学生 Token 访问 `/biz/**` 必返回 `401` |
| **P0-2：登录/改密/重置密码明文传输 + 初始密码明文落库** | 前端内置 `smCrypto.js` 对登录/改密密码执行 **SM2 非对称加密**；后端 `CommonCryptogramUtil.doSm2Decrypt` 解密后以 **SM3** 摘要入库；敏感手机号/身份证/紧急联系人采用 **SM4-CBC** 落库 | 迁移阶段将 `SYS_USER.PHONE`、`CLIENT_USER.PHONE`、`BIZ_STUDENT_PROFILE.MOBILE`、`EMERGENCY_CONTACT_MOBILE` 全部执行 SM4-CBC 加密落库；微信小程序同步接入 SM2 |
| **P0-3：`/uploads` 静态目录裸露绕过文件鉴权** | `DEV_FILE` 支持 `IS_DOWNLOAD_AUTH = 1`，文件存储于 MinIO（`warnsys-files`），统一下载端点校验登录态与权限 | 迁移 `files`（37 条）至 `DEV_FILE` 时全部设置 `IS_DOWNLOAD_AUTH = 1`，不暴露静态直链 |
| **P0-4：未启用全局 Default-Deny 鉴权** | `GlobalConfigure` 注册 `SaServletFilter` 全局默认拦截至登录态，所有 B 端方法级强制 `@SaCheckPermission("/biz/...")` | M2/M3 所有 Controller 100% 标注 `@SaCheckPermission` 与 `@CommonLog` |
| **P1-1：删除/批量删除遗漏 `@DataScope` 导致跨院/跨班越权** | 小诺原生 `SYS_USER_DATA_SCOPE` + `StpLoginUserUtil.getLoginUserDataScope()` 提供机构级数据权限集合 | 结合 `BIZ_CLASS.COUNSELOR_USER_ID` 与学院 `ORG_ID` 做强制服务层数据范围二次校验 |
| **P1-2/P1-3：权限缓存不同步、改密/禁用不吊销旧 Token** | Sa-Token 基于 Redis（`sa-token.alone-redis`）实时生效；禁用用户/踢下线直接调用 `StpUtil.kickout` / `StpUtil.logout` | 禁用账号、改密、重置密码、角色变更后即时清理 Sa-Token 会话与权限缓存 |
| **P2-1：前端无按钮级权限、依赖可篡改 `localStorage`** | `hasPerm('camelCaseBtnCode')` 结合服务端实时下发的 `buttonCodeList` 与动态路由菜单控制 | 每个新增/修改/删除/审批/导入/导出按钮均配置 `SYS_RESOURCE(category='BUTTON')` |

---

## 三、基础设施与环境拓扑规范

### 3.1 运行服务（已核实可用）
| 组件 | 容器名 / 路径 | 宿主机端口 / 地址 | 关键配置 |
|---|---|---|---|
| **MySQL 8.0.36** | `warnsys-mysql` | `127.0.0.1:3307`（容器内 `3306`） | 目标库：`snowy`（`utf8mb4_general_ci`）；源库：`warnsys`（**只读不写**） |
| **Redis 7.2** | `warnsys-redis` | `127.0.0.1:6380`（容器内 `6379`） | 无密码；Snowy 配置 `spring.data.redis.database=1` |
| **MinIO** | `warnsys-minio` | API `127.0.0.1:9100` / 控制台 `9101` | AK：`minioadmin`，SK：`minioadmin123`，Bucket：`warnsys-files` |
| **Snowy 后端** | `C:\Users\WS\Desktop\Snowy-master` | `http://127.0.0.1:82` | Profile：`local`（`application-local.properties`） |
| **Snowy 前端** | `C:\Users\WS\Desktop\Snowy-master\snowy-admin-web` | `http://127.0.0.1:81` | Vite 代理 `/api` → `http://127.0.0.1:82` |

### 3.2 Maven 编译命令（基于本地 Docker 镜像 `maven:3.9-eclipse-temurin-17`）
```powershell
docker run --rm `
  -v "C:\Users\WS\Desktop\Snowy-master:/workspace" `
  -v "$env:USERPROFILE\.m2:/root/.m2" `
  -w /workspace `
  maven:3.9-eclipse-temurin-17 `
  mvn clean install -DskipTests
```

---

## 四、38 张源表 → 小诺融合库全量映射与确定性 ID 规则

### 4.1 确定性雪花风格 ID 映射规则
为保证**幂等可重跑、全外键 100% 一致、与 Snowy 原生雪花 ID（`1543...` / `1570...`）绝对不碰撞**，所有从 `warnsys` 迁入的主键 ID 统一按以下 19 位定长规则生成（完全满足 `VARCHAR(20)` 且纯数字雪花格式）：
$$\text{NEW\_ID} = \text{CONCAT}('190', \text{LPAD}(\text{table\_code}, 2, '0'), \text{LPAD}(\text{old\_id}, 14, '0'))$$

#### 表编号对照表（`table_code`：01 ~ 38）
| Code | 源表 (`warnsys`) | 目标表 (`snowy`) | 源表行数（实测） | 迁移类别 |
|---|---|---|---|---|
| `01` | `orgs` | `SYS_ORG` | 5 | A 类（融入原生表） |
| `02` | `users`（非学生） | `SYS_USER` + `SYS_USER_EXT` | 12 | A 类（融入原生表） |
| `03` | `users`（学生） | `CLIENT_USER` + `CLIENT_USER_EXT` + `AUTH_THIRD_USER` | 212 | A 类（融入原生表） |
| `04` | `user_roles` | `SYS_RELATION` + `SYS_USER_DATA_SCOPE` | 14（B 端分配） | A 类（角色与范围映射） |
| `05` | `majors` | `BIZ_MAJOR` | 8 | B 类（代码生成器兼容表） |
| `06` | `classes` | `BIZ_CLASS` | 5 | B 类（代码生成器兼容表） |
| `07` | `student_profiles` | `BIZ_STUDENT_PROFILE` | 212 | B 类（代码生成器兼容表） |
| `08` | `courses` | `BIZ_COURSE` | 21 | B 类（代码生成器兼容表） |
| `09` | `course_classes` | `BIZ_COURSE_CLASS` | 16 | B 类（代码生成器兼容表） |
| `10` | `schedules` | `BIZ_SCHEDULE` | 15 | B 类（代码生成器兼容表） |
| `11` | `teacher_course_bindings` | `BIZ_TEACHER_COURSE_BINDING` | 30 | B 类（代码生成器兼容表） |
| `12` | `calendar_exclusions` | `BIZ_CALENDAR_EXCLUSION` | 0 | B 类（代码生成器兼容表） |
| `13` | `warning_rules` | `BIZ_WARNING_RULE` | 4 | B 类（代码生成器兼容表） |
| `14` | `message_templates` | `BIZ_MESSAGE_TEMPLATE` | 15 | B 类（代码生成器兼容表） |
| `15` | `class_notifications` | `BIZ_CLASS_NOTIFICATION` | 141 | B 类（代码生成器兼容表） |
| `16` | `student_notification_reads` | `BIZ_STUDENT_NOTIFICATION_READ` | 44 | B 类（代码生成器兼容表） |
| `17` | `grades` | `BIZ_GRADE` | 1 | B 类（代码生成器兼容表） |
| `18` | `leave_requests` | `BIZ_LEAVE_REQUEST` | 6 | B 类（代码生成器兼容表） |
| `19` | `makeup_requests` | `BIZ_MAKEUP_REQUEST` | 0 | B 类（代码生成器兼容表） |
| `20` | `appeals` | `BIZ_APPEAL` | 3 | B 类（代码生成器兼容表） |
| `21` | `change_requests` | `BIZ_CHANGE_REQUEST` | 33 | B 类（代码生成器兼容表） |
| `22` | `class_sessions` | `BIZ_CLASS_SESSION` | 123 | C 类（引擎/状态/日志表） |
| `23` | `class_session_snapshots` | `BIZ_CLASS_SESSION_SNAPSHOT` | 123 | C 类（以 `SESSION_ID` 为主键） |
| `24` | `attendance_records` | `BIZ_ATTENDANCE_RECORD` | 4,742 | C 类（引擎/状态/日志表） |
| `25` | `daily_records` | `BIZ_DAILY_RECORD` | 728 | C 类（引擎/状态/日志表） |
| `26` | `warnings` | `BIZ_WARNING` | 363 | C 类（引擎/状态/日志表） |
| `27` | `warning_current_states` | `BIZ_WARNING_CURRENT_STATE` | 364 | C 类（引擎/状态/日志表） |
| `28` | `student_warning_snapshots` | `BIZ_STUDENT_WARNING_SNAPSHOT` | 211 | C 类（以 `STUDENT_ID` 为主键） |
| `29` | `class_monitor_snapshots` | `BIZ_CLASS_MONITOR_SNAPSHOT` | 0 | C 类（以 `CLASS_ID` 为主键） |
| `30` | `warning_cases` | `BIZ_WARNING_CASE` | 159 | C 类（引擎/状态/日志表） |
| `31` | `warning_case_logs` | `BIZ_WARNING_CASE_LOG` | 379 | C 类（引擎/状态/日志表） |
| `32` | `weekly_summaries` | `BIZ_WEEKLY_SUMMARY` | 0 | C 类（引擎/状态/日志表） |
| `33` | `monthly_summaries` | `BIZ_MONTHLY_SUMMARY` | 0 | C 类（引擎/状态/日志表） |
| `34` | `term_summaries` | `BIZ_TERM_SUMMARY` | 1 | C 类（引擎/状态/日志表） |
| `35` | `notification_jobs` | `BIZ_NOTIFICATION_JOB` | 1,116 | C 类（引擎/状态/日志表） |
| `36` | `notification_logs` | `BIZ_NOTIFICATION_LOG` | 1,242 | C 类（引擎/状态/日志表） |
| `37` | `export_jobs` | `BIZ_EXPORT_JOB` | 111 | C 类（引擎/状态/日志表） |
| `38` | `files` | `DEV_FILE` | 39 | A 类（融入原生表） |
| `39` | `notification` | `DEV_MESSAGE` + `DEV_RELATION` | 1,769 | A 类（融入原生表） |
| `40` | `audit_logs` | `DEV_LOG` (`CATEGORY='OPERATE'`) | 12,370 | A 类（融入原生表） |
| `41` | `security_events` | `DEV_LOG` (`CATEGORY='SEC'`) | 154 | A 类（融入原生表） |
| `42` | `system_settings` | `DEV_CONFIG` (`CATEGORY='BIZ_DEFINE'`) | 17 | A 类（融入原生表） |
| `43` | `auth_third_user`（派生） | `AUTH_THIRD_USER` | 按微信 openid 派生 | A 类（融入原生表） |

> **说明**：原 `permissions`、`role_permissions`、`user_permissions`、`auth_challenges`、`dashboard_cache`、`idempotency_keys` 属于权限与运行时缓存机制表，由 Snowy 原生 `SYS_RESOURCE` + `SYS_RELATION` + `Redisson` + `@CommonNoRepeat` 替代，不迁移旧运行时碎片。

### 4.2 特殊脏数据与边界处理规范
1. **`orgs.parent_org_id = 1` 孤儿父节点**：源库 `orgs` 表 id=2 的记录指向 `parent_org_id = 1`，但源库 `orgs` 无 id=1 行 → 在 `02_biz_warnsys_init.sql` 预设学校根节点 `ID = '1900100000000000000'`（名称：`学校总部`，`PARENT_ID = '0'`，`CATEGORY = 'COMPANY'`），迁移时所有 `parent_org_id IS NULL` 或父节点缺失的组织均挂载到 `1900100000000000000`。
2. **`SYS_USER` / `CLIENT_USER` 账号唯一性**：
   - 非学生 `SYS_USER.ACCOUNT`：`COALESCE(NULLIF(TRIM(mobile),''), NULLIF(TRIM(email),''), CONCAT('staff_', id))`，确保不与 `superAdmin` / `bizAdmin` 重复；
   - 学生 `CLIENT_USER.ACCOUNT`：优先取 `student_profiles.student_no`（全库唯一）。
3. **密码迁移与 SM3 兼容策略**：
   - `SYS_USER.PASSWORD` 与 `CLIENT_USER.PASSWORD` 统一初始化为合法 SM3 摘要（对于有 `student_profiles.initial_password` 的学生直接计算其真实初始密码的 SM3；其余账号设为默认密码 SM3，并在 `EXT_JSON` 中保留原 `legacy_bcrypt_hash`，M3/M4 登录增强可无缝验证一次 bcrypt 并自动升级为 SM3）。
4. **敏感字段 SM4-CBC 落库加密**：
   - `SYS_USER.PHONE`、`CLIENT_USER.PHONE`、`BIZ_STUDENT_PROFILE.MOBILE`、`BIZ_STUDENT_PROFILE.EMERGENCY_CONTACT_MOBILE` 迁入时先保留明文到临时态，随后在 M1.6 中运行基于 Snowy `CommonCryptogramUtil.doSm4CbcEncrypt()` 的 Java 加密标准化工具批量加密并做加解密闭环验证。

---

## 五、分阶段详细执行清单（Checklist）

### Milestone 1：底座初始化 + 数据库融合 + 全量迁移（已完成 100%）
- [x] **M1.0** 盘点源库 `warnsys` 38 张表结构、真实行数与边界脏数据；核实 `Snowy-master` 原生表结构与枚举常量
- [x] **M1.1** 编写并执行全局计划文档 `docs/WARNSYS_SNOWY_MIGRATION_PLAN.md`（本文件）
- [x] **M1.2** 在 `warnsys-mysql` 中新建纯净库 `snowy`（`utf8mb4_general_ci`）并导入官方 `snowy_mysql.sql`
- [x] **M1.3** 编写并执行 `docs/sql/01_biz_warnsys_schema.sql`（创建 33 张 `BIZ_*` 业务表 + `BIZ_MIGRATION_ID_MAP`，全部符合 `CommonEntity` + `VARCHAR(20)` + 中文 `COMMENT`）
- [x] **M1.4** 编写并执行 `docs/sql/02_biz_warnsys_init.sql`（初始化学校根节点、5 个业务角色 `SYS_ROLE`、12 组业务字典 `DEV_DICT`、MinIO 配置 `DEV_CONFIG`、4 个定时任务占位 `DEV_JOB`）
- [x] **M1.5** 编写并执行 `docs/sql/03_migrate_warnsys_to_snowy.sql`（全量迁移 38 张表全部历史数据至 `snowy` 库，包含 `BIZ_MIGRATION_ID_MAP`）
- [x] **M1.6** 执行国密 SM3 / SM4 标准化加密工具（调用 `CommonCryptogramUtil` 加密 `SYS_USER.PHONE`、`CLIENT_USER.PHONE`、`BIZ_STUDENT_PROFILE.MOBILE/EMERGENCY_CONTACT_MOBILE` 与计算 SM3 口令摘要）
- [x] **M1.7** 编写并执行 `docs/sql/04_verify_migration.sql`（逐表行数 0 误差校验、外键孤儿记录为 0 校验、中文编码抽检）
- [x] **M1.8** 配置 `snowy-web-app/src/main/resources/application-local.properties`，使用 `maven:3.9-eclipse-temurin-17` 完成全模块 `mvn clean install -DskipTests`
- [x] **M1.9** 启动 Snowy 后端容器并实测验证码、超管 SM2 登录、代码生成器 `/gen/basic/tables` 识别全部 `BIZ_*` 表与中文注释

---

### Milestone 2：16 个基础档案与台账模块（在线开发 + 六件套 + 前端 + 权限）
> **模块策略**：全部放于 `snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/{domain}`，前端放于 `snowy-admin-web/src/views/biz/{domain}` + `src/api/biz/{domain}Api.js`，并同步落盘 `SYS_RESOURCE` 菜单/按钮权限 SQL。

- [x] **M2.1 基础组织与教务档案（6 域）**
  - [x] `major`（`BIZ_MAJOR` 专业管理：左树按学院筛选 + CRUD + `@SaCheckPermission("/biz/major/...")`）
  - [x] `clazz`（`BIZ_CLASS` 班级管理：绑定班主任 `COUNSELOR_USER_ID` + CRUD + 关联计数保护）
  - [x] `student`（`BIZ_STUDENT_PROFILE` 学生档案：联动创建 `CLIENT_USER` + SM4 手机加密 + 微信解绑 + 账号导出 + Excel 批量导入）
  - [x] `course`（`BIZ_COURSE` 课程管理：CRUD + Excel 批量导入）
  - [x] `courseclass`（`BIZ_COURSE_CLASS` 开课班管理：课程×班级×任课教师×学期 + Excel 导入）
  - [x] `schedule`（`BIZ_SCHEDULE` 排课课表：学期课表维护 + Excel 导入 + 模板配置）
- [x] **M2.2 规则、校历与消息模板（4 域）**
  - [x] `calendar`（`BIZ_CALENDAR_EXCLUSION` 校历排除日管理）
  - [x] `warningrule`（`BIZ_WARNING_RULE` 预警规则：校级默认 + 院级覆盖）
  - [x] `msgtemplate`（`BIZ_MESSAGE_TEMPLATE` 邮件/短信/站内信模板维护 + 调试发送）
  - [x] `classnotice`（`BIZ_CLASS_NOTIFICATION` + `BIZ_STUDENT_NOTIFICATION_READ` 班级公告与已读统计）
- [x] **M2.3 业务台账与教学记录（6 域）**
  - [x] `teacherbinding`（`BIZ_TEACHER_COURSE_BINDING` 教师授课绑定管理）
  - [x] `grade`（`BIZ_GRADE` 成绩管理：CRUD + Excel 导入）
  - [x] `leaverequest`（`BIZ_LEAVE_REQUEST` 请假台账与管理端视图）
  - [x] `makeuprequest`（`BIZ_MAKEUP_REQUEST` 考勤补录台账与管理端视图）
  - [x] `appeal`（`BIZ_APPEAL` 学生申诉工单台账）
  - [x] `changerequest`（`BIZ_CHANGE_REQUEST` 教师换院/换课/学生换班变更台账）
- [x] **M2.4 菜单与按钮权限统一注册**
  - [x] 编写并执行 `05_sys_resource_menus_m2_1.sql`、`06_sys_resource_menus_m2_2.sql`、`07_sys_resource_menus_m2_3.sql`（3 目录、16 菜单、72 按钮码 `camelCase`）
  - [x] 为 `superAdmin`、`bizAdmin`、`head_teacher`、`teacher`、`student_admin`、`teaching_admin`、`vice_dean` 配置默认角色资源授权（`SYS_RELATION`）

---

### Milestone 3：5 大核心业务引擎迁移至 `snowy-plugin-biz`
- [x] **M3.1 课堂考勤签到引擎（`modular/attendance`）**
  - [x] 创建/批量创建/批量结束/批量删除课次（含 Redisson 分布式锁防并发重复结算）
  - [x] 动态轮换二维码签发与校验（时间窗滚动口令 + 强制换码重置种子作废旧码 + 防重放）
  - [x] 日考勤/作业/课堂表现批量录入（`BIZ_DAILY_RECORD` 无损合并）与课次快照刷新（`BIZ_CLASS_SESSION_SNAPSHOT`）
  - [x] `DevJob` 定时任务实现：排课自动开课（`BizScheduleSessionJobRunner`）、超时自动结课判缺勤（`BizSessionAutoCloseJobRunner`）
  - [x] Ant Design Vue 前端：`SignInBoard.vue` 动态二维码大屏 + 实时花名册状态面板 + `daily.vue` 批量表现录入
- [x] **M3.2 学业预警计算与高风险干预引擎（`modular/warning`）**
  - [x] 规则引擎核心：`BIZ_WARNING_RULE` 院级覆盖校级匹配、校历排除日过滤、已批准请假豁免与方向感知阈值比较
  - [x] 实时预警状态表（`BIZ_WARNING_CURRENT_STATE`）与历史表（`BIZ_WARNING`）双写与升级/条件消除自动关闭
  - [x] 学生预警快照（`BIZ_STUDENT_WARNING_SNAPSHOT`）、班级看板快照（`BIZ_CLASS_MONITOR_SNAPSHOT`）及周/月/学期汇总计算
  - [x] 高风险干预工单（`BIZ_WARNING_CASE` + `BIZ_WARNING_CASE_LOG`）指派、接单、处置、结案闭环
  - [x] `DevJob` 定时任务实现：每日预警全量扫描（`BizDailyWarningScanJobRunner`）
- [x] **M3.3 多角色工作台与审批联动引擎（`modular/workbench` & `modular/approval`）**
  - [x] 班主任工作台（绑班、本班概览、请假审批、换班初审）
  - [x] 任课教师工作台（绑院、绑课、课堂签到管理、发起变更申请/补录审核）
  - [x] 学工管理员工作台（绑院、院级覆盖规则、通知防骚扰策略、预警处置）
  - [x] 教务管理员 & 教学副院长工作台（课程绑定审批、两段式变更与特批审批流）
  - [x] 审批联动事务：请假通过 → 自动更新 `BIZ_ATTENDANCE_RECORD`/`BIZ_DAILY_RECORD` → 重算学生预警；补录通过 → 回填 `BIZ_DAILY_RECORD` 与签到记录；申诉办结 → 关闭预警；变更终审 → 真实写回学籍/成绩/院系/绑课
- [x] **M3.4 异步通知分发 & EasyExcel 报表导出 & 统计大屏（`modular/notify`, `report`, `stats`）**
  - [x] 通知队列分发器（`BizNotificationDispatchJobRunner`）：冷却去重、静默免打扰时段、调用 `DevEmailApi`/`DevSmsApi`/`DevMessageApi`
  - [x] EasyExcel 异步导出（日/周/月/学期报表、学生账号单）→ 上传 `DevFileApi`（`IS_DOWNLOAD_AUTH = 1`）并支持鉴权流式下载
  - [x] ECharts 统计仪表盘（校级总览 / 院级学工 / 班主任班级 三视角，严格受数据范围约束）

---

### Milestone 4：微信小程序（`miniprogram`）全量对接小诺 C 端
- [x] **M4.1 后端 C 端接口层（`/client/c/warnsys/**`，在 `GlobalConfigure` 强制 `StpClientUtil.checkLogin()`）**
  - [x] 登录与账号安全：微信 `wx.login` 一键登录/绑定（`AUTH_THIRD_USER`）、学号+姓名+SM2密码登录、兼容历史 bcrypt 首次自动升级 SM3、找回密码/改密
  - [x] 学业与考勤：今日课表、本周课表、汇总统计、课程列表、扫码签到（`checkin`）
  - [x] 预警与消息：我的预警列表与详情、确认预警、站内信列表/未读数/已读、班级公告、偏好设置
  - [x] 申请与文件：请假申请与列表、申诉申请与列表、换班申请、图片鉴权上传/下载（`/client/c/warnsys/file/...`）
- [x] **M4.2 小程序前端改造（`c:\Users\WS\Desktop\school-warning-system-master\miniprogram`，UI 零改动）**
  - [x] 引入小程序可用 SM2 加密工具（`utils/sm2.js` + `utils/smCrypto.js`），登录/改密/重置密码全程 SM2 加密
  - [x] 改造 `utils/request.js` 与 `config.js`：适配小诺 `token` 请求头、`code === 200` 响应规范、新 C 端路由映射与文件鉴权下载

---

### Milestone 5：全链路安全渗透验收与上线切换
- [x] **M5.1** 自动化接口安全回归：用 C 端学生 Token 调用 30 项 `/biz/**`、`/sys/**`、`/dev/**`、`/gen/**`，100% 返回 `401`（含反向 B 端超管调 C 端接口必 `401`）
- [x] **M5.2** 登录抓包审计：B 端与 C 端登录/改密/重置密码拒绝明文、强制 SM2 密文；库中口令均为 64 位 SM3（非 SM3=0），手机号/初始密码均为 SM4-CBC 密文（明文=0）
- [x] **M5.3** 横向/纵向越权测试：不同学院 `student_admin`（`org3 -> org2`）越权查/删/导/看大屏 100% 拦截；高权限接口纵向提权 13 项 100% 返回 `403`；前端 `hasPerm` 与 `@SaCheckPermission` / `SYS_RESOURCE` 按钮全量对齐
- [x] **M5.4** 交付完整部署手册与增量割接方案：[WARNSYS_DEPLOYMENT_AND_CUTOVER_GUIDE.md](file:///C:/Users/WS/Desktop/Snowy-master/docs/WARNSYS_DEPLOYMENT_AND_CUTOVER_GUIDE.md)，二次校验 `04_verify_migration.sql` 全业务表 0 差异、8 项外键孤儿 0

---

## 六、执行日志（Execution Log）

### [2026-11-25 16:05] M1.0 源库与底座现状盘点完成
- 核实 `warnsys-mysql`（`3307`）、`warnsys-redis`（`6380`）、`warnsys-minio`（`9100`）均处于健康运行状态。
- 核实本地 Docker 已具备 `maven:3.9-eclipse-temurin-17` 镜像及 `$env:USERPROFILE\.m2` 缓存，可完成 Java 17 编译打包。
- 核实 `warnsys` 源库全部 38 张表结构与外键依赖，发现 `orgs` 存在 1 条 `parent_org_id=1` 指向缺失根节点的边界记录，已纳入迁移修复规则。

### [2026-11-25 19:57] M1.1 ~ M1.9 底座融合与全量迁移全部完成并通过实测
- **M1.2 ~ M1.4 数据库融合**：在 `warnsys-mysql` 创建 `snowy` 库（`utf8mb4_general_ci`），导入官方 `snowy_mysql.sql`（33 张原生表），随后执行 [01_biz_warnsys_schema.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/01_biz_warnsys_schema.sql) 与 [02_biz_warnsys_init.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/02_biz_warnsys_init.sql)，建出 33 张 `BIZ_*` 业务表 + `BIZ_MIGRATION_ID_MAP`（共 67 张表），初始化学校总部根节点 `1900100000000000000`、5 个业务角色（`1909000000000000001..005`）、12 组 `DEV_DICT` 业务字典、MinIO 配置及 4 个 `STOPPED` 状态 `DEV_JOB` 占位。
- **M1.5 ~ M1.7 全量数据迁移 + 国密 SM3/SM4 标准化 + 零误差校验**：
  - 执行 [03_migrate_warnsys_to_snowy.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/03_migrate_warnsys_to_snowy.sql) 完成全部源库历史数据迁移（源库 `warnsys` 保持严格只读未改动）。
  - 通过 Docker JDK 17 运行 [MigrationCryptoStandardizer.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-web-app/src/test/java/vip/xiaonuo/MigrationCryptoStandardizer.java) 调用 `CommonCryptogramUtil` 完成国密标准化：`sysPwd=12, sysSm4=12, cliPwd=212, cliSm4=212, spSm4=212`。
  - 复跑 [04_verify_migration.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/04_verify_migration.sql) 实测结果：**42 项表对源/目标行数 `diff` 全部为 `0`**（含 `BIZ_ATTENDANCE_RECORD=4742`、`BIZ_DAILY_RECORD=728`、`BIZ_WARNING=363`、`BIZ_WARNING_CURRENT_STATE=364`、`BIZ_WARNING_CASE=159`、`BIZ_NOTIFICATION_JOB=1116`、`BIZ_NOTIFICATION_LOG=1242`、`DEV_MESSAGE=1769`、`DEV_LOG(OPERATE)=12370`、`DEV_LOG(SEC)=154`、`SYS_USER(19002%)=12`、`CLIENT_USER(19003%)=212` 等），**8 项外键孤儿检查全部为 `0`**，`PENDING_SM3` 剩余 **`0`**，UTF-8 中文内容抽检完整无乱码；`SYS_USER.PASSWORD` / `CLIENT_USER.PASSWORD` 均为 64 位 SM3 十六进制摘要，`SYS_USER.PHONE` 与 `BIZ_STUDENT_PROFILE.INITIAL_PASSWORD` 为 SM4-CBC 密文。
- **M1.8 全模块编译打包**：配置 [application-local.properties](file:///C:/Users/WS/Desktop/Snowy-master/snowy-web-app/src/main/resources/application-local.properties)，通过 `maven:3.9-eclipse-temurin-17` 执行全 19 模块编译打包，`mvn clean install -DskipTests` 与 `mvn test-compile -pl snowy-web-app -am -DskipTests`（03:14 min）均 `BUILD SUCCESS`，产出 `snowy-web-app-3.0.0.jar`。
- **M1.9 运行时端点与代码生成器实测**：
  - 使用 `eclipse-temurin:17-jre` 启动临时验证容器 `snowy-m1-verify`（端口 `82`，连 `warnsys-mysql:3306/snowy` 与 `warnsys-redis:6379` db1），23.529 秒完成启动并缓存 65 条资源 URL。
  - `GET /auth/b/getPicCaptcha` → `HTTP 200, code=200`。
  - `POST /auth/b/doLogin`（`superAdmin` / `Snowy@2026!` SM2 密文）→ `HTTP 200, code=200, msg=操作成功`。
  - `POST /auth/b/doLogin`（迁移管理员 `12345678911` / `Snowy@2026!` SM2 密文）→ `HTTP 200, code=200, msg=操作成功`（实测验证迁移用户的 SM3 口令可直接通过 Snowy B 端登录体系）。
  - `GET /gen/basic/tables` → `HTTP 200, code=200`，识别到全部 33 张新增 `BIZ_*` 业务表 + `BIZ_MIGRATION_ID_MAP` + `BIZ_NOTICE` 及其完整中文 `tableRemark`（如 `BIZ_APPEAL (学生申诉工单)`、`BIZ_ATTENDANCE_RECORD (课堂签到记录)`、`BIZ_STUDENT_PROFILE (学生档案)` 等）。验证完成后已清理临时容器 `snowy-m1-verify` 释放 `82` 端口。

---

### [2026-11-25 20:32] M2.1 基础组织与教务档案 6 域开发完成并通过实测
- **ClientApi 跨插件打通**：在 [snowy-plugin-biz/pom.xml](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/pom.xml) 引入 `snowy-plugin-client-api`，扩展 [ClientUserApi.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin-api/snowy-plugin-client-api/src/main/java/vip/xiaonuo/client/ClientUserApi.java) 与 [ClientUserApiProvider.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-client/src/main/java/vip/xiaonuo/client/modular/user/provider/ClientUserApiProvider.java)，实现学生档案创建/编辑/删除/重置密码/解绑微信与 `CLIENT_USER` / `CLIENT_USER_EXT` / `AUTH_THIRD_USER` 及 `StpClientUtil` 强制下线全联动。
- **后端 6 域全套代码落地**：
  - 公共数据范围工具：[BizScopeUtil.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/core/util/BizScopeUtil.java)
  - 专业模块：`vip.xiaonuo.biz.modular.major`（[BizMajorController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/major/controller/BizMajorController.java)）—— 同院重名校验 + 删除前班级/学生关联计数保护。
  - 班级模块：`vip.xiaonuo.biz.modular.clazz`（[BizClassController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/clazz/controller/BizClassController.java)）—— 批量统计 `studentCount`、班主任分配自动同步 `head_teacher` 角色、9 张子表关联计数防误删。
  - 学生档案模块：`vip.xiaonuo.biz.modular.student`（[BizStudentProfileController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/student/controller/BizStudentProfileController.java)）—— `CommonSm4CbcTypeHandler` 自动加解密手机号/紧急联系人/初始密码、`@JsonIgnore` 防止列表泄露初始密码、SM2 密文入参重置密码、EasyExcel 账号导出与带 `dryRun` 批量导入。
  - 课程 / 开课班 / 排课课表：`vip.xiaonuo.biz.modular.course`、`courseclass`、`schedule`，全量配备 `@SaCheckPermission`、`@CommonLog`、数据范围过滤与 EasyExcel 模板/批量导入。
- **前端 Ant Design Vue 4 模块与 API 落地**：在 `snowy-admin-web/src/api/biz/` 与 `src/views/biz/` 新增 `bizMajorApi.js` / `bizClassApi.js` / `bizStudentApi.js` / `bizCourseApi.js` / `bizCourseClassApi.js` / `bizScheduleApi.js`、公共组件 [BizImportModal.vue](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/views/biz/components/BizImportModal.vue) / [useOrgTree.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/views/biz/components/useOrgTree.js) 及 6 套 `index.vue` + `form.vue` 页面。
- **菜单、按钮与 RBAC 权限落库**：执行 [05_sys_resource_menus_m2_1.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/05_sys_resource_menus_m2_1.sql)，注册 7 条 `MENU`（1 目录 + 6 菜单）、31 条 `BUTTON`（`camelCase` 按钮码），并按职责向 `superAdmin`、`bizAdmin`、`teaching_admin`、`student_admin`、`vice_dean`、`head_teacher`、`teacher` 写入 `SYS_ROLE_HAS_RESOURCE` 与 `SYS_ROLE_HAS_PERMISSION`（`SCOPE_ALL` / `SCOPE_ORG_CHILD`）。
- **编译与运行时集成实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块 `BUILD SUCCESS`（03:37 min）。
  - 容器实测结果：
    - `superAdmin` 分页查询 6 域全通：`major(total=8)`、`clazz(total=5)`、`student(total=212)`、`course(total=21)`、`courseclass(total=16)`、`schedule(total=15)`，全部 `code=200`。
    - 学院数据范围生效：`student_admin`（`123456127`，人工智能学院）查询 `/biz/student/page` 仅返回本院 `91` 条。
    - 越权隔离生效：`teacher`（`18181919245`）请求 `/biz/student/page` 返回 `code=403 (无此权限：/biz/student/page)`；无 Token 请求返回 `code=401 (未能读取到有效 token)`。
    - EasyExcel 流式下载实测：`exportAccounts` 返回 `11226 bytes`、`course/importTemplate` 返回 `3714 bytes`。
    - 学生档案增删改与重置密码闭环：新建学生→生成10位强密码并联动写入 `CLIENT_USER`→重置密码→级联清理删除恢复基线，全程 `code=200`。

---

### [2026-11-25 20:45] M2.2 规则、校历排除、消息模板与班级公告 4 域开发完成并通过实测
- **后端 4 域全套代码落地（`snowy-plugin-biz`）**：
  - 校历排除日：`vip.xiaonuo.biz.modular.calendar`（[BizCalendarExclusionController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/calendar/controller/BizCalendarExclusionController.java)）—— 支持全校/院级两级作用域、按月筛选、重复日期校验及院级管理员新增校级日期拦截。
  - 学业预警规则：`vip.xiaonuo.biz.modular.warningrule`（[BizWarningRuleController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warningrule/controller/BizWarningRuleController.java)）—— 继承 12 项指标白名单与学期指标（`failed_courses`/`credits`/`gpa`）仅限 `term` 窗口校验，实现修改判定参数时自动递增 `ruleVersion`。
  - 消息模板：`vip.xiaonuo.biz.modular.msgtemplate`（[BizMessageTemplateController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/msgtemplate/controller/BizMessageTemplateController.java)）—— 支持 4 渠道编码去重、`{var}` 模板变量预览渲染及对接 `DevEmailApi`/`DevSmsApi` 调试发送。
  - 班级公告：`vip.xiaonuo.biz.modular.classnotice`（[BizClassNotificationController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/classnotice/controller/BizClassNotificationController.java)）—— 批量统计 `readCount / totalStudents`、提供已读学生明细 `/biz/classnotice/readStats` 及删除级联清理已读表。
- **前端 4 域视图与 API 落地**：新增 `bizCalendarApi.js` / `bizWarningRuleApi.js` / `bizMsgTemplateApi.js` / `bizClassNoticeApi.js` 及 `src/views/biz/{calendar,warningrule,msgtemplate,classnotice}/{index,form}.vue`。
- **菜单与 RBAC 权限落库**：执行 [06_sys_resource_menus_m2_2.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/06_sys_resource_menus_m2_2.sql)，新增 5 条 `MENU`（1 目录 + 4 菜单）、17 条 `BUTTON` 及全角色授权。
- **编译与运行时集成实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块 `BUILD SUCCESS`（04:41 min）。
  - 容器实测（缓存资源 URL 总数升至 `136`）：
    - 分页查询：`calendar(total=0)`、`warningrule(total=4)`、`msgtemplate(total=15)`、`classnotice(total=141)` 全返回 `code=200`。
    - 规则护栏验证：`failed_courses`+`day` 组合被拒绝；`student_admin`（`123456127`）越权新增全校规则被拦截；规则阈值编辑后 `ruleVersion` 自动由 `1` 递增为 `2`（临时规则已清理）。
    - 模板预览 `/biz/msgtemplate/testSend` 与公告已读 `/biz/classnotice/readStats`（`total=91, read=0`）返回 `code=200`；`teacher`（`18181919245`）请求 `/biz/msgtemplate/page` 返回 `code=403`。

---

### [2026-11-25 21:28] M2.3 教学绑定、成绩与四大业务台账 6 域开发完成并通过实测（Milestone 2 100% 收官）
- **后端 6 域全套代码落地（`snowy-plugin-biz`）**：
  - 教师授课绑定：`vip.xiaonuo.biz.modular.teacherbinding`（[BizTeacherCourseBindingController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/teacherbinding/controller/BizTeacherCourseBindingController.java)）—— 按学院数据范围过滤分页，支持课程/班级筛选及绑定查重。
  - 学生成绩管理：`vip.xiaonuo.biz.modular.grade`（[BizGradeController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/grade/controller/BizGradeController.java)）—— CRUD + `@Trans` 映射 + EasyExcel 成绩导入模板与带 `dryRun` 批量导入。
  - 请假台账：`vip.xiaonuo.biz.modular.leaverequest`（[BizLeaveRequestController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/leaverequest/controller/BizLeaveRequestController.java)）—— 按班级所属学院数据范围隔离，校验结束时间晚于开始时间及驳回必填 `rejectReason`。
  - 考勤补录台账：`vip.xiaonuo.biz.modular.makeuprequest`（[BizMakeupRequestController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/makeuprequest/controller/BizMakeupRequestController.java)）—— JSON 变更内容校验、课程 `@Trans(fields = "courseName")` 翻译及驳回原因校验。
  - 学生申诉工单：`vip.xiaonuo.biz.modular.appeal`（[BizAppealController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/appeal/controller/BizAppealController.java)）—— 支持 `approved` / `resolved` / `rejected` 状态流转与处理说明校验。
  - 信息变更台账：`vip.xiaonuo.biz.modular.changerequest`（[BizChangeRequestController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/changerequest/controller/BizChangeRequestController.java)）—— 统一承接学生换班/档案、教师授课/换院与成绩变更请求，兼容 B 端与历史 C 端申请人还原展示及跨类型机构范围校验。
- **前端 6 域视图与 API 落地**：新增 `bizTeacherBindingApi.js` / `bizGradeApi.js` / `bizLeaveRequestApi.js` / `bizMakeupRequestApi.js` / `bizAppealApi.js` / `bizChangeRequestApi.js` 及 `src/views/biz/{teacherbinding,grade,leaverequest,makeuprequest,appeal,changerequest}/{index,form}.vue`（成绩页复用 `BizImportModal.vue`）。
- **菜单与 RBAC 权限落库**：执行 [07_sys_resource_menus_m2_3.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/07_sys_resource_menus_m2_3.sql)，新增 7 条 `MENU`（1 目录 + 6 菜单）、24 条 `BUTTON`、`41` 条 `SYS_ROLE_HAS_RESOURCE` 与 `136` 条 `SYS_ROLE_HAS_PERMISSION`。
- **编译与运行时集成实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块 `BUILD SUCCESS`（05:38 min）。
  - 容器实测（缓存资源 URL 总数由 `136` 升至 `166`）：
    - 未授权请求 `/biz/grade/page` 返回 `code=401`。
    - `superAdmin` 全 6 域分页查询全通：`teacherbinding(total=30)`、`grade(total=1)`、`leaverequest(total=6)`、`makeuprequest(total=0)`、`appeal(total=3)`、`changerequest(total=33)`，全部 `code=200`。
    - 学院数据范围生效：`student_admin`（`123456127`）查询返回本院切片：`teacherbinding(total=16)`、`grade(total=0)`、`leaverequest(total=6)`、`changerequest(total=9)`。
    - RBAC 隔离生效：`teacher`（`18181919245`）请求 `/biz/teacherbinding/page` 与 `/biz/grade/page` 返回 `code=200`，请求 `/biz/leaverequest/page`、`/biz/makeuprequest/page`、`/biz/appeal/page`、`/biz/changerequest/page` 均返回 `code=403`。
    - EasyExcel 模板流下载：`GET /biz/grade/importTemplate` 返回 `HTTP 200, bytes=3746`。
    - 审批/处理闭环实测：补录（驳回缺原因拦截→通过→详情 `status=approved, courseName=大学物理`→清理）、申诉（受理→`resolved, resultNote=核实通过`→清理）、信息变更（通过→`status=approved, requesterName=超管`→清理）全部通过。

---

### [2026-11-25 22:07] M3.1 课堂考勤签到引擎开发完成并通过实测
- **后端核心引擎落地（`snowy-plugin-biz`）**：
  - 实体与映射：`BizClassSession`、`BizAttendanceRecord`、`BizDailyRecord`、`BizClassSessionSnapshot`。
  - 动态二维码工具：[BizAttendanceQrUtil.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/attendance/util/BizAttendanceQrUtil.java) —— 支持 `WARNSYS_WARNING.qrRefreshSeconds` 时间片滚动口令、宽限期校验与换码立即失效。
  - 核心服务与控制器：[BizClassSessionServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/attendance/service/impl/BizClassSessionServiceImpl.java)、[BizDailyRecordServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/attendance/service/impl/BizDailyRecordServiceImpl.java)、[BizAttendanceSnapshotServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/attendance/service/impl/BizAttendanceSnapshotServiceImpl.java)、[BizAttendanceController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/attendance/controller/BizAttendanceController.java)，使用 Redisson 锁保障并发结课/换码一致性，并以 `java.sql.Date` 修复了跨时区 `RECORD_DATE` 去重合并。
  - `DevJob` 定时任务对接：[BizScheduleSessionJobRunner.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/core/timer/BizScheduleSessionJobRunner.java) 与 [BizSessionAutoCloseJobRunner.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/core/timer/BizSessionAutoCloseJobRunner.java)。
- **前端与菜单权限落地**：新增 [bizAttendanceApi.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/api/biz/bizAttendanceApi.js) 与 `src/views/biz/attendance/{index,form,SignInBoard,daily}.vue`；执行 [08_sys_resource_menus_m3_1.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/08_sys_resource_menus_m3_1.sql)，新增 `1` 目录、`2` 菜单、`7` 按钮、`21` 条 `SYS_ROLE_HAS_RESOURCE` 与 `80` 条 `SYS_ROLE_HAS_PERMISSION`。
- **编译与容器联调实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块 `BUILD SUCCESS`（03:43 min）。
  - `snowy-backend`（`TZ=Asia/Shanghai`）缓存资源 URL 总数升至 `180`，实测验证：未授权 `/biz/attendance/session/page` 返回 `code=401`；`superAdmin` 课次分页 `total=123`、日记录分页 `total=728`；`student_admin`（`123456127`）院级数据范围 `total=32`；`teaching_admin`（`123456124`）调用 `/biz/attendance/session/delete` 返回 `code=403`；发起课次→动态码强轮换（`8588526c157686b3` → `9d14451787877e45`）→花名册改状态→提前结课（`absentMarked=90`）→日记录作业/违纪合并写入不覆盖出勤→级联清理恢复基线（`123/4742/728/123`）全部通过。

---

### [2026-11-25 22:21] M3.2 学业预警计算与高风险干预引擎开发完成并通过实测
- **后端核心引擎落地（`snowy-plugin-biz`）**：
  - 9 张表实体与映射：`BizWarning`、`BizWarningCurrentState`、`BizStudentWarningSnapshot`、`BizClassMonitorSnapshot`、`BizWeeklySummary`、`BizMonthlySummary`、`BizTermSummary`、`BizWarningCase`、`BizWarningCaseLog`。
  - 预警计算引擎：[BizWarningEngineServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warning/service/impl/BizWarningEngineServiceImpl.java) —— 支持校/院规则优先级覆盖、校历排除日过滤、已批准请假豁免、学分/绩点低值反向阈值比较、Redisson 学生粒度的防并发双写（`BIZ_WARNING_CURRENT_STATE` + `BIZ_WARNING`）及条件满足消除后自动关闭。
  - 汇总与快照引擎：[BizSummaryServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warning/service/impl/BizSummaryServiceImpl.java)、[BizWarningSnapshotServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warning/service/impl/BizWarningSnapshotServiceImpl.java)。
  - 高风险干预工单与控制器：[BizWarningCaseServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warning/service/impl/BizWarningCaseServiceImpl.java)、[BizWarningController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warning/controller/BizWarningController.java) —— 提供 `pending_assignment -> assigned -> in_progress -> completed -> resolved` 全生命周期流转日志闭环。
  - `DevJob` 定时任务：[BizDailyWarningScanJobRunner.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/core/timer/BizDailyWarningScanJobRunner.java)（对接 `DEV_JOB 1909100000000000003`）。
- **前端与菜单权限落地**：新增 [bizWarningApi.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/api/biz/bizWarningApi.js) 与 `src/views/biz/warning/{index,case,summary}.vue`；执行 [09_sys_resource_menus_m3_2.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/09_sys_resource_menus_m3_2.sql)，新增 `1` 目录、`3` 菜单、`9` 按钮、`20` 条 `SYS_ROLE_HAS_RESOURCE` 与 `78` 条 `SYS_ROLE_HAS_PERMISSION`。
- **编译与容器联调实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块一次性 `BUILD SUCCESS`（03:40 min）。
  - `snowy-backend` 缓存资源 URL 总数升至 `198`，实测验证：未授权返回 `code=401`；`superAdmin` 分页 `warning(363)`、`case(159)`、`termSummary(1)`；`student_admin`（`123456127`）院级过滤 `warning(211)`；`teacher` 越权访问 `/biz/warning/page` 返回 `code=403`，`head_teacher` 越权指派工单返回 `code=403`；汇总重算产出周/月各 `182` 条、学期 `1` 条；单生触发评估产生 `2` 条预警并自动建工单（`riskScore=55`），完整走通 `assign -> accept -> complete -> resolve`（5 条日志）并实测添加校历排除日重扫后自动关闭预警（`warningsClosed=2`），人工构造测试数据已清理完毕。

---

### [2026-11-25 22:57] M3.3 多角色工作台与审批联动引擎开发完成并通过实测
- **跨表事务联动闭环落地（M2.3 Ledger Services）**：
  - [BizLeaveRequestServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/leaverequest/service/impl/BizLeaveRequestServiceImpl.java)：请假审批通过后，同事务将请假时段内重叠 `BIZ_CLASS_SESSION` 签到异常记录（`absent`/`late`/`early_leave`）及 `BIZ_DAILY_RECORD` 同步修正为 `leave`（`source='leave_sync'`），刷新课次快照并触发 `BizWarningEngineService.evaluateStudent` 自动消警。
  - [BizMakeupRequestServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/makeuprequest/service/impl/BizMakeupRequestServiceImpl.java)：考勤补录审批通过后解析 `changeJson`（`attendance_status`/`homework_status`/`class_behavior`/`session_id`），通过 `BizDailyRecordService.batchUpsert` 合并写入 `BIZ_DAILY_RECORD` 并回填 `appliedDailyRecordId`，同步修正关联课次记录与预警。
  - [BizAppealServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/appeal/service/impl/BizAppealServiceImpl.java)：申诉 `approved`/`resolved` 办结时，若 `relatedType='warning'` 则自动关闭关联预警（`closeNote='申诉办结自动关闭：...'`），否则重算学生实时预警与风险工单。
  - [BizChangeRequestServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/changerequest/service/impl/BizChangeRequestServiceImpl.java)：实现 `student_profile_class_change` 两段式流转（`head_teacher` 初审→`pending_dean`→副院长/管理员终审→`approved`），终审通过按 `targetType`（`student_profile_class_change` / `student_profile` / `grade` / `teacher_org_change` / `teacher_course_binding_change`）真实落库并联动刷新预警/快照。
  - 顺带修复 [BizWarningCurrentStateMapper.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/warning/mapper/BizWarningCurrentStateMapper.java) 与 `BizWarningEngineServiceImpl`：将 `BIZ_WARNING_CURRENT_STATE` 消警/关闭改用 `@Delete` 物理删除，彻底避免 `@TableLogic` 软删与唯一索引 `UK_BIZ_WCS_COURSE` 在同窗口重触发时的冲突。
- **多角色协同工作台落地（`modular/workbench`）**：
  - 新增 `BizWorkbenchController` / `BizWorkbenchServiceImpl`（4 个权限路由：`/biz/workbench/overview`、`/biz/workbench/notificationStrategy`、`/biz/workbench/notificationStrategy/save`、`/biz/workbench/specialApproveChange`），支持 `vice_dean`/`teaching_admin`/`student_admin`/`head_teacher`/`teacher` 五维视角聚合、`DEV_CONFIG` 学院防骚扰策略读写与特批终审。
  - 新增前端 [bizWorkbenchApi.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/api/biz/bizWorkbenchApi.js)、[workbench/index.vue](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/views/biz/workbench/index.vue) 及 [10_sys_resource_menus_m3_3.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/10_sys_resource_menus_m3_3.sql)（新增 `2` 条 MENU/CATALOG、`2` 条 BUTTON、`14` 条 `SYS_ROLE_HAS_RESOURCE` 与 `22` 条 `SYS_ROLE_HAS_PERMISSION`）。
- **编译与全链路端到端验证结果**：
  - `mvn install -DskipTests -T 1C` 全 19 模块一次性 `BUILD SUCCESS`（`03:47 min`），`snowy-backend` 缓存资源 URL 总数升至 `202`（`TZ=Asia/Shanghai` 运行中）。
  - `VerifyM3Workbench` 全量断言通过（退出码 `0`）：未登录 `401`；`superAdmin` 切换 5 视角及 `vice_dean`/`teaching_admin`/`student_admin`/`head_teacher`/`teacher` 实测账号概览全 `200`（`totalStudents=212`）；越权切视角拦截、`teacher` 调策略保存 `403`、`head_teacher` 调特批终审 `403`；防骚扰策略读写还原通过；实测“缺勤→触发黄牌预警→班主任批假→日考勤转 `leave/leave_sync` 且预警 `closed`”、“补录通过→回填 `appliedDailyRecordId` 与 `present/submitted`”、“申诉办结→自动关闭关联预警”、“转班申请→`head_teacher` 初审 `pending_dean`→`vice_dean` 特批终审→`BIZ_STUDENT_PROFILE` 实际变更并在院级隔离后安全还原”。清理全部人工测试数据，恢复基线 `daily_total=728, warn_total=363, wcs_total=364, case_total=159, synth_left=0`。

---

### [2026-11-25 23:18] M3.4 异步通知分发、EasyExcel 鉴权导出与 ECharts 大屏完成并通过实测（Milestone 3 全部收官）
- **异步通知分发引擎与定时器（`modular/notify` & `core/timer`）**：
  - 新增 `BizNotificationJob`、`BizNotificationLog` 实体与映射，以及 [BizNotifyController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/notify/controller/BizNotifyController.java)、[BizNotifyServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/notify/service/impl/BizNotifyServiceImpl.java) —— 支持 `inbox`/`wechat`/`email`/`sms` 多渠道模板渲染（`{var}`/`${var}`）、Redis 冷却窗口去重、静默免打扰顺延、对接 `DevMessageApi`/`DevEmailApi`/`DevSmsApi` 并写入回执日志与已读确认。
  - 新增 `DevJob` 定时调度执行器 [BizNotificationDispatchJobRunner.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/core/timer/BizNotificationDispatchJobRunner.java)（对接 `DEV_JOB 1909100000000000004` + Redisson 分布式锁）。
- **EasyExcel 报表导出与鉴权下载（`modular/report`）**：
  - 新增 `BizExportJob`、[ReportExcelRows.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/report/excel/ReportExcelRows.java)、[BizReportServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/report/service/impl/BizReportServiceImpl.java) 与 [BizReportController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/report/controller/BizReportController.java) —— 支持 `daily`/`weekly`/`monthly`/`semester`/`student_accounts` 五类报表与 `school`/`org`/`class` 严格权限范围导出（含 SM4 初始密码安全解密导出），通过 `DevFileApi.storageStreamReturnId` 落库 `DEV_FILE` 并通过 `/biz/report/download` 鉴权下载。
- **三视角 ECharts 统计驾驶舱（`modular/stats`）**：
  - 新增 [BizStatsController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/stats/controller/BizStatsController.java) 与 [BizStatsServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/stats/service/impl/BizStatsServiceImpl.java) —— 严格按 `BizScopeUtil` 提供全校/院级/班级三视角（院/班角色尝试请求 `school` 视角直接拒绝），输出等级分布、指标分类、学院对比、近8周趋势与高风险班级排行。
- **前端与菜单权限落地**：
  - 新增 [bizNotifyApi.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/api/biz/bizNotifyApi.js)、[bizReportApi.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/api/biz/bizReportApi.js)、[bizStatsApi.js](file:///C:/Users/WS/Desktop/Snowy-master/snowy-admin-web/src/api/biz/bizStatsApi.js) 与 `src/views/biz/{stats,notify,report}/index.vue`。
  - 执行 [11_sys_resource_menus_m3_4.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/11_sys_resource_menus_m3_4.sql)，新增 `4` 条 `MENU/CATALOG`、`4` 条 `BUTTON`、`25` 条 `SYS_ROLE_HAS_RESOURCE` 与 `61` 条 `SYS_ROLE_HAS_PERMISSION`。
- **编译与全链路实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块一次性 `BUILD SUCCESS`（`03:50 min`）；`snowy-backend` 缓存资源 URL 升至 `214` 条（`http://localhost:82` 运行中）。
  - `VerifyM3Analytics` 全量通过（退出码 `0`）：未登录 `401`；校/院/班三视角实测 `school(212)`/`org(91)`/`class(91)`，院级 `student_admin` 请求全校视角拒绝拦截；通知入队即发 `sent` + 同 `cooldownKey` 冷却窗口自动拦截 `cancelled` + `head_teacher` 回执确认；`teacher` 访问通知与报表接口严格 `403`；EasyExcel 导出 `weekly(91行)` 与全校 `student_accounts(212行)`，`/biz/report/download` 实测返回 `7014 bytes` 合法 XLSX（`PK` 魔数），院级越权导出全校直接拒绝。测试数据清理完毕，恢复基线 `BIZ_NOTIFICATION_JOB=1116, BIZ_NOTIFICATION_LOG=1242, BIZ_EXPORT_JOB=111`。

---

### [2026-11-25 23:37] M4 微信小程序 C 端全量对接完成并通过实测（UI 零改动）
- **C 端控制器与安全隔离落地（`snowy-plugin-biz` & `GlobalConfigure`）**：
  - [GlobalConfigure.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-web-app/src/main/java/vip/xiaonuo/core/config/GlobalConfigure.java)：仅在 `NO_LOGIN_PATH_ARR` 放行 `/client/c/warnsys/auth/{login,wxLogin,sendCode,verifyCode,recovery/**}`，其余全部 `/client/c/warnsys/**` 路由继续由 `SaServletFilter` 强制执行 `StpClientUtil.checkLogin()`。
  - [BizClientWarnsysController.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/client/controller/BizClientWarnsysController.java) 与 [BizClientWarnsysServiceImpl.java](file:///C:/Users/WS/Desktop/Snowy-master/snowy-plugin/snowy-plugin-biz/src/main/java/vip/xiaonuo/biz/modular/client/service/impl/BizClientWarnsysServiceImpl.java)：落地 30+ 项 C 端接口，覆盖 SM2 密文校验与历史 bcrypt 首次转 SM3、微信 `AUTH_THIRD_USER`/`WX_OPENID` 绑定登录、Redis 验证码找回/改密、今日/本周课表与汇总、我的预警确认、请假/申诉/换班提交、个人站内信/班级公告统一已读、滚动二维码扫码签到（`BizAttendanceQrUtil`）与附件归属校验上传下载。
- **小程序纯网络/国密 JS 层改造（零 UI 改动）**：
  - 新增 [sm2.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/utils/sm2.js)、[smCrypto.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/utils/smCrypto.js)，改造 [config.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/config.js)（`http://localhost:82`、`token` 请求头）、[request.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/utils/request.js)（`code === 200 || 0`、`/client/c/warnsys/**` 路由映射、登录/改密/重置密码自动 SM2 密文加密）及 [checkin.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/pages/checkin/checkin.js)（19 位雪花课次 ID 字符串透传）；全部 `.wxml`/`.wxss` 页面保持零改动。
- **编译与安全隔离实测**：
  - `mvn install -DskipTests -T 1C` 全 19 模块 `BUILD SUCCESS`（`04:22 min`）；`VerifyM4Client` 全部通过（退出码 `0`）：未登录 `401`；明文登录拦截拒绝；SM2 密文登录（`202600200201`）与微信 `wxLogin` 均成功；8 类 B 端管理接口（`/biz/**`、`/sys/**`、`/dev/**`、`/gen/**`）持 C 端 Token 访问全部严格返回 `401`；动态二维码签到成功（`on_time`）；跨学生确认他人预警 IDOR 越权拦截。测试数据清理完毕，恢复基线 `att_total=4742, sess_total=123, daily_total=728`。

---

### [2026-11-25 23:40] Milestone 5 全链路安全渗透验收与交付收官（全局进度 100%）
- **M5.1 B/C 端双向鉴权隔离回归**：`VerifyM5Penetration` 实测使用学生 C 端 Token 调用 30 项 B 端、系统、开发、代码生成接口（`/biz/**`、`/sys/**`、`/dev/**`、`/gen/**`）100% 返回 `401`；反向使用超管 B 端 Token 调用受保护 `/client/c/warnsys/student/profile` 亦返回 `401`。
- **M5.2 国密算法与密码库表核验**：实测 B 端与 C 端明文密码登录直接拦截失败，强制 SM2 密文传输；库表抽检 `SYS_USER_NON_SM3=0`、`CLIENT_USER_NON_SM3=0`、`BIZ_STU_PLAIN_MOBILE=0`、`BIZ_STU_PLAIN_INITPWD=0`。
- **M5.3 横向/纵向越权渗透与按钮权限对齐**：
  - 横向：人工智能学院（`1900100000000000003`）`student_admin` 越权访问文学院（`1900100000000000002`）学生详情/删除、班级删除、学院大屏与学院报表导出 100% 阻断。
  - 纵向：`teacher` 访问 `/biz/{student,warning,notify/job,report,leaverequest}/page` 与 `/sys/user/page`，`teaching_admin` 删课次，`head_teacher` 触发删预警/重扫/指派工单/特批/保存策略/通知分发等共 13 项高权限接口 100% 返回 `403`。
  - 静态核验 `snowy-admin-web/src/views/biz/**/*.vue` 全部 `hasPerm(...)` 标识与数据库 `SYS_RESOURCE (CATEGORY='BUTTON')` 及 `@SaCheckPermission` 对齐无遗漏。
- **M5.4 一致性复跑与交付文档**：
  - 二次复跑 [04_verify_migration.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/04_verify_migration.sql)：39 张基础/业务迁移表行数 `diff=0`（外加 M3.2 实算重建的 `BIZ_CLASS_MONITOR_SNAPSHOT=2`、`BIZ_WEEKLY_SUMMARY=182`、`BIZ_MONTHLY_SUMMARY=182`），8 项外键孤儿检查全为 `0`，`PENDING_SM3=0`。
  - 正式交付运维部署与增量割接手册：[WARNSYS_DEPLOYMENT_AND_CUTOVER_GUIDE.md](file:///C:/Users/WS/Desktop/Snowy-master/docs/WARNSYS_DEPLOYMENT_AND_CUTOVER_GUIDE.md)。
  - 线上联调环境保持就绪：`snowy-backend`（`http://localhost:82`，214 条缓存路由）与 `snowy-admin-web`（`http://localhost:81`）持续在线，微信小程序（`miniprogram` UI 零改动）已接入 SM2 与 `/client/c/warnsys/**`。
