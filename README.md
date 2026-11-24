# 学业预警系统（WARNSYS）

面向高校的学业预警与考勤闭环平台：教务排课 → 二维码签到 → 缺勤/迟到/早退自动汇总 → 多级预警（黄/橙/红/严重）→ 高风险干预工单 → 审计留痕。

- **后端**：NestJS 10 + Prisma 5 + MySQL 8.0.36 + Redis 7.2（Streams 队列）+ MinIO
- **管理端**：Vue 3 + Vite + Element Plus（Claymorphism 绿系软陶主题、滑动页签、按用户分配权限）
- **小程序**：`miniprogram/` 纯学生端（Claymorphism 绿系软陶主题，支持签到、课表、预警确认/申诉、请假、成绩与双通道消息）
- **部署**：Docker Compose（dev / prod 两套），Nginx 同时托管 SPA 与 `/api` 反代

> **分支说明**：
> - `master` 分支仅保留本 `README.md`（含项目说明与按时间戳归档的更新记录）。
> - `261124` 分支保存截至 `2026-11-24` 的最新完整项目源码（含模块精简、小程序同步、报表导出修复、数据范围越权收敛与宽表/构建修复）。
> - `261122` 分支保存截至 `2026-11-22` 的历史归档版本。
> - `261121` 分支保存截至 `2026-11-21` 的历史归档版本。

---

## 更新记录（按时间戳分类）

### `2026-11-24 21:00` — 功能模块精简（双端同步）、报表导出“生成中”修复与数据范围安全加固
- **删除 5 个功能模块并同步至后端、管理端前端与微信小程序**（保留数据库表结构以兼容历史快照）：
  - **课表管理**：删除后端 `backend/src/schedules/` 模块及 `import.service.ts` / `data-scope.interceptor.ts` / `permission-catalog.ts` 中课表相关逻辑；删除管理端 `Schedules.vue`、`MySchedules.vue` 及对应路由菜单与 `api/schedules.ts`；小程序端移除 `pages/schedules/`、`app.json` 与 `custom-tab-bar` 中的「课表」Tab（保留首页 / 我的预警 / 我的 3 个 Tab）及 `utils/request.js` 相关封装。
  - **高风险干预**：删除后端 `backend/src/warning-cases/` 模块及 `stats`、`warning`、`warnings`、`student-admin`、`vice-dean` 中的案例同步与统计查询；删除管理端 `InterventionCases.vue`、路由菜单、`api/warnings.ts` 案例接口，以及 `WarningStatsDashboard.vue` / `ClassOverview.vue` 中的高风险入口。
  - **成绩管理**：删除后端 `teaching-admin/grades*`、`students/grades` 接口与 `grade:*` 权限定义；删除管理端 `GradesManage.vue` 及模板配置中的成绩/课表项；小程序端删除 `pages/grades/`、个人中心成绩入口、`summaries` 学期绩点卡片与申诉类型中的「成绩申诉」。
  - **学期起始设置 & 学籍变更**：删除后端 `teaching-admin/semester-config` 与 `teaching-admin/students*` 接口；删除管理端 `SemesterSettings.vue`、`StudentProfileManage.vue` 及对应菜单路由，`ClassExport.vue` 改为本地推算默认学期起始周。
- **修复报表导出点击后一直显示“生成中”**（`backend/src/reports/reports.controller.ts`、`export-processor.service.ts`、`admin-frontend/src/pages/Reports.vue`）：
  - 后端在创建日/周/月/学期导出任务后通过 `triggerExportJob` 即时触发一次生成（最多同步等待 2 秒，超时继续由后台与 `@Cron` 完成），并新增超过 5 分钟僵死 `running` 任务的自动恢复。
  - 修复 `buildSummaryReport`：按导出参数时间区间（`date` / `startDate`-`endDate` / `month` / `semester`）、状态和学院范围直接分页查询 `warnings` 明细导出 `.xlsx`，不再依赖月度字符串转数字或已移除的成绩汇总表。
  - 前端修复「生成中」计数逻辑（排除 `failed` 状态），新增存在生成中任务时每 2 秒自动轮询刷新、手动「刷新状态」按钮及失败原因 Tooltip 提示。
- **合入 `261124` 安全与构建修复**：
  - 合入 `origin/261124` 的数据范围安全收敛（`student`/`class_monitor` 收敛为 `self`，空范围返回空数组不退化为全校）、宽表操作列与趋势列裁切修复、`start.ps1` UTF-8 BOM 修复及后端 Jest 配置。
  - 修复 `admin-frontend/vite.config.ts` 中 `unplugin-vue-components` 在生产构建阶段并发写入 `components.d.ts` 导致 Windows 下构建失败的问题（改为仅 `serve` 模式生成声明文件）。

### `2026-11-22 23:00` — 预警中心与签到统计修复、表格 Tooltip 宽度同步与启停脚本优化
- **预警中心交互与预警引擎优化**（`admin-frontend/src/pages/Warnings.vue`、`backend/src/warnings/warnings.controller.ts`、`backend/src/warning/`）：
  - 移除班级预警中心的自动刷新定时器与开关，保留手动刷新（穿透前端缓存），解决页面周期性跳动与分页被重置的问题。
  - 将班级学生花名册单页容量提升至 `500`（后端默认 `500` / 上限 `1000`），常规班级一次加载全班学生，不再需要反复点击「加载更多学生」；精简冗余的「查看范围」切换栏并优先展示完整触发原因。
  - 优化批量预警生成 `generateWarningsBatchOptimized`：支持跨时间窗（日/周/月/学期）内存聚合与原地自动升级，统一触发原因文案；确认预警接口同步兼容 `warning_current_states` 与历史 `warnings` 状态更新。
- **签到管理与统计快照一致性修复**（`admin-frontend/src/pages/Attendance.vue`、`TeacherAttendance.vue`、`backend/src/attendance/attendance.controller.ts`）：
  - 修复单次提前结束及批量结束签到（`finalizeSessionEarly`）未刷新 `class_session_snapshots` 导致签到列表统计长期显示全 `0` 的问题；`GET /attendance/sessions` 新增已结束课次陈旧快照自动自愈与缺勤数兜底计算；批量结束改为补录缺勤完成后合并统一结算预警。
  - 管理员端与教师端课次列表改用行底色 + 状态圆点图例区分「进行中 / 未开始 / 已结束」，精简冗余列提升一屏可读性。
- **全局表格与 Tooltip 截断修复**（`admin-frontend/src/lib/responsive-table.ts`、`admin-frontend/src/styles/theme.css`、`Warnings.vue`）：
  - 宽表横向溢出时新增顶部同步横向滚动条、右侧 `sticky` 固定操作列与 `Shift + 滚轮` 横向滚动。
  - 新增 `syncTooltipCellWidths`，在列宽自适应、手动拖拽调宽及数据重渲染时同步更新 `.cell.el-tooltip` 内联宽度，并将预警明细「触发原因」列改为 `min-width="280"`，彻底解决列很宽但内容仍在 `220px` 处被截断省略的问题。
- **Windows 一键启停脚本优化**（`start.ps1`、`stop.bat`、`stop.ps1`）：
  - `stop.bat` / `stop.ps1` 默认改为 `docker compose stop`（保留容器与网络以便下次秒起），新增 `-Purge` 参数按需清理容器/网络（始终保留数据卷），并按仓库路径与监听端口精确清理残留 Node 进程。

### `2026-11-22 17:10` — 收尾修复：报表状态/统计口径、开发代理、表格列宽、旧表清理与 `.env` 合并
- 详细说明见 **[docs/变更说明-2026-11-22.md](docs/变更说明-2026-11-22.md)**。要点：
  - 报表导出状态统一为 `completed`（下载端兼容旧 `success`），修复“永远显示生成中、无下载按钮”。
  - 报表历史改为**按数据范围可见**（全校看全部，学院/班级/本人看自己+范围内），新增「创建人」列，下载/删除权限同步对齐。
  - 「预警统计-1 · 院系处置表现」不再出现“未知学院”，组织名按“有预警 ∪ 有学生”补齐。
  - Vite 开发代理按 `Accept: text/html` 区分页面与接口，直链刷新 `/warnings` 等路由不再变成 JSON。
  - 全局表格不再压缩内容列（补齐 `.cell` 内边距测量），宽表改为横向滚动，杜绝“计…/2026-11-…”截断。
  - 库内清理 47 张旧系统表（`EDU_*`/`SYS_*`/`DEV_*` 等），重导 `db/mysql/warnsys.sql` 与 `.gz` 快照并更新 `db/README.md` 基线。
  - 根目录 `.env` 成为唯一配置源：容器内连接串由 compose 固定为服务名，`backend/.env` 改为指向根 `.env` 的硬链接，`start.ps1` 自动创建。

### `2026-11-22 00:25` — 预警双端一致闭环、自适应表格、小程序液态玻璃 UI 与一键启停脚本（重点）
- **Windows 一键启停脚手架**（[start.bat](start.bat) / [start.ps1](start.ps1) / [stop.bat](stop.bat) / [stop.ps1](stop.ps1)）：
  - 一键自动拉起 Docker Desktop 与 MySQL / Redis / MinIO 基础容器并等待健康就绪，随后启动本地后端与 Vite 前端（支持 `-Docker` / `-Dev` / `-Rebuild` / `-KeepDocker` / `-NoPause`）；一键关闭优雅清理进程并完整保留数据卷。
- **预警与消息双端数据一致性修复**：
  - 修复学生端确认预警（`POST /student/warnings/:id/confirm`）未同步更新 `warning_current_states` 与缓存失效的缺陷；管理员确认（`POST /warnings/:id/ack`）改为原地匹配更新未关闭记录，彻底杜绝同一预警出现多条重复记录。
  - 修复 `WarningService` 批量重算使用 `skipDuplicates: true` 导致管理端与小程序缺勤次数/状态脱节的问题，改为事务双向同步与升级重开（`当前触发次数`、`status_text`、`violation_count` 两端对齐）。
  - 学生端默认过滤「已关闭」历史覆盖记录，仅展示升级后的最新有效预警，并醒目显示真实缺勤次数（如 `缺勤 2 次`）；修复首页与消息中心班级公告未读数因分页差异不一致的问题（统一读取后端全量 `unread`）。
- **管理端布局重构与全局表格自适应**（`admin-frontend/`）：
  - `responsive-table.ts` 新增全局 Canvas 测宽自动适配列宽能力，根据字段与按钮实际宽度动态分配并压缩宽列以消灭多余横向滚动条；修复 `api/classes.ts` 学院与专业接口 `/api/orgs` 404 错误；调整签到课次表列宽使状态与操作按钮完整单行并排；彻底移除右下角「表」悬浮控件。
  - 重构 `Warnings.vue` 预警中心：在筛选卡片展示所选「学院 / 专业 / 班级」路径，学生花名册改为上方紧凑多列网格（去掉冗余班级/专业，支持「全部 / 仅看有预警」筛选），合并压缩详情气泡与明细表格列宽。
- **小程序学生端 UI 全面升级**（`miniprogram/`）：
  - 修复 `utils/request.js` 相对路径白屏与 `"style": "v2"` 默认按钮样式导致的文字换行裁切问题。
  - 升级全局液态玻璃气泡平滑滑动控件（`.glass-track` / `.glass-bubble`，覆盖全部平行分段与筛选条）并新增带 4 枚 SVG 图标的悬浮玻璃底部导航栏（`custom-tab-bar`）。
  - 扫码签到仅保留直接扫码（首页点击「扫码签到」直接拉起相机完成提交），精简首页（移除「今日概览」与「学生服务入口」板块并修复多行 `<text>` 气泡拉高问题），统一放大全站字号、标签与按钮尺寸。

### `2026-11-21 18:15` — 微信小程序（纯学生端）全面升级与 Claymorphism UI 统一
- **后端学生端接口补齐与对齐**：
  - 升级 `GET /student/today` 与 `GET /student/weekly`：统一以 `Date.UTC` 对齐 `@db.Date` 日期查询，聚合当日多门课程出勤、作业、课堂表现与课表课程数。
  - 新增 `GET /student/grades`：关联查询学生课程成绩明细、绩点、学分与修读统计，支持按学期 `term_code` 筛选。
  - 升级 `GET /student/warnings`：补齐 `metric`、`period_end`、`trigger_detail_json`、`rule_snapshot_json`、`acknowledged_at`、`close_note` 字段，修复 `acknowledged` / `student_acknowledged` 过滤与统计计数。
  - 在 `GET /student/profile` 补充返回 `photo_file_id`；在 `GET/PUT /student/preferences` 双向同步 `wechat`、`sms`、`email`、`quiet_hours` 与 `notification_channels`。
  - 升级 `POST /attendance/checkin`：成功响应返回 `checkin_time`，校验非数字 `session_id` 并细化过期/无效口令中文提示。
- **小程序 UI 与全链路能力升级**（24 个页面，仅限学生使用）：
  - `app.json` / `app.wxss` 对齐 Web 端 `clay-theme.css` 绿系软陶风格（`#f1f2fa` 基底、`#fffdf7` 卡片、`#4f9e6f`/`#3f8a5d` 主绿、`#383139` 文字），移除旧版蓝色风格。
  - 新增受保护图片带 Bearer Token 鉴权下载与大图预览（`utils/request.js` + `utils/media.js`），全面支持请假证明、申诉凭证、换班佐证与证件照预览。
  - 升级双通道消息中心（个人站内信 `/student/inbox` + 班级公告 `/student/notifications`）、学期/校历周次课表（`/schedules/view`）、我的成绩、预警一键转申诉、邮箱/手机验证码绑定与换绑、邮箱验证修改密码及找回密码闭环。

### `2026-11-21 17:30` — 万人规模高并发与学业预警业务闭环优化
- **数据范围与越权拦截补漏**：
  - `GET /attendance/sessions` 增加 DataScope 过滤并仅向拥有签到管理/查看权限的角色下发动态 `scan_token`；`/attendance/sessions/:id/{attendance,qr-state,records}` 与 `saveDailyRecords` 补全课次与班级管理权限校验；`checkin` 双写包裹为 Prisma 事务。
  - 修复班主任/辅导员 `bind-org` 被重复调用覆盖问题；`GET /student/available-classes` 移除 `@Public()` 匿名暴露；学生管理与导出的分页参数全面强制限制在 `1..100`。
- **万人规模性能与内存安全**：
  - 修复 Redis `XREADGROUP BLOCK 0` 阻塞共享连接问题，独立 consumer `duplicate()` 连接并限制 `WARNING_QUEUE_READ_BLOCK_MS >= 1000`；`DataScopeInterceptor` 与 `TeachingAdminController` 本地缓存设容量上限与过期清扫；成绩分布统计改为单次遍历 O(N)，避免 `Math.max(...scores)` 栈溢出；可访问学生查询改为关联过滤，消除超大规模 `IN (...)` 列表。
- **业务闭环打通**：
  - `approveMakeupRequest` 与 `handleAppeal` 审批通过时自动关联关闭相应预警并触发学生预警重算；`WarningsController` 确认操作改为条件原子事务更新。
  - 通知分发任务（API 与 Worker）增加 5 分钟 `running` 租约超时自动恢复与指数退避重试；审计日志对嵌套敏感字段递归脱敏且默认跳过高频只读 `GET`。

### `2026-11-21 16:30` — 代码审查与 P0/P1/P2 安全加固
- 完成代码审查报告中的安全与稳定性整改：
  - `.env.example`、`docker-compose.yml`、`docker-compose.prod.yml`、`backend/prisma/seed.ts` 增加生产与非空库多重防护门禁（`SEED_ON_MIGRATE=false` 与 `ALLOW_DESTRUCTIVE_SEED=true` 门控），防止容器重启误清生产库；`docker-compose.prod.yml` 仅对本机回环绑定管理端口并补齐独立 `worker` 容器服务。
  - 前端登录移除 `localStorage` 明文密码持久化，登出主动调用 `POST /auth/logout` 吊销 Token `jti`。
  - 后端收口开放注册开关默认值为 `false` 与非学生角色可注册标记；学生登录接入 Redis IP+学号 5 分钟 10 次失败限流并统一防枚举错误提示；图形验证码改用 `crypto.randomInt`。
  - 文件上传启用 JPEG/PNG/WEBP/GIF 魔数（Magic Bytes）校验，下载端校验上传者或对应业务读取权限并添加 `X-Content-Type-Options: nosniff`；`/health` 增加 1 秒超时 `SELECT 1` 数据库实测探针。

### `2026-11-20 00:52` — 运行数据快照归档与运维文档完善
- 建立 `db/` 脱库数据快照目录（MySQL 全量逻辑备份、Redis RDB/AOF 快照、MinIO 三个 Bucket 原始对象文件）。
- 配置 `.gitattributes` 二进制规则与 `README.md` 启动、恢复及排错手册。

### `2026-11-19 20:00` — 学业预警系统基础版本初始化
- 构建 NestJS 10 后端 + Vue 3 管理端 + 原生微信小程序学生端全套工程架构。
- 完成组织/班级/课程/排课、滚动二维码签到、多窗口分级预警引擎、高风险工单处置、RBAC 动态权限、Redis Streams 异步重算队列及 Docker Compose 编排。

---

## 一、前置要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Docker Desktop | 24+（含 Compose v2） | 一键拉起 MySQL / Redis / MinIO / 后端 / Worker / 前端 |
| Node.js | 20 LTS | 仅在「本地开发模式」需要 |
| 操作系统 | Windows 10/11、macOS、Linux | 命令以 bash 为主，Windows 用 PowerShell 等价 |

确认环境：

```bash
docker --version && docker compose version
node -v    # 可选，本地开发才需要
```

---

## 二、从 0 启动（5 步，约 3~5 分钟）

### 1. 准备配置

```bash
cp .env.example .env
```

打开 `.env`，**至少改这几个值**（其余保持默认即可）：

```ini
MYSQL_ROOT_PASSWORD=换成你的强口令
MYSQL_PASSWORD=改成同样的值（与 DATABASE_URL 里保持一致）
DATABASE_URL=mysql://warnuser:你的MYSQL_PASSWORD@mysql:3306/warnsys

JWT_SECRET=至少32位随机串
MINIO_ROOT_PASSWORD=换成你的口令
MINIO_SECRET_KEY=与 MINIO_ROOT_PASSWORD 相同

WARNING_BASELINE_DATE=2026-11-19   # 预警统计起点，早于该日期的数据不计入
```

> `.env` 已在 `.gitignore` 里，不会进入仓库；换机时按本文件重新生成即可。

### 2. 拉起全部容器

```bash
docker compose up -d --build
```

首次会依次完成：拉镜像 → 编译后端（`prisma generate` + `tsc`）→ 打前端镜像 → 启动 MySQL/Redis/MinIO → `minio-init` 建 bucket → `migrate` 执行 `prisma migrate deploy`（失败则 `db push`）→ 启动 `backend` / `worker` / `frontend`。

### 3. 等待健康

```bash
docker compose ps
```

期望看到 `warnsys-mysql / warnsys-redis / warnsys-minio / warnsys-backend / warnsys-worker / warnsys-frontend` 都是 `Up (healthy)`。

### 4. 登录与初始化数据

浏览器打开 **http://localhost**（会自动跳到 `/login`）。如需从 `db/` 恢复已有数据，见第四节；若为空库首次初始化 seed，需显式设置环境变量后再执行 seed（默认禁用破坏性清库重置）。

### 5. 验证主链路

1. 「课程课次」建一门课 + 一个开课班 → 「签到明细」新建课次 → 打开签到看板（二维码 + 已签/未签）
2. 学生通过小程序或扫码签到 → 看板 2 秒内刷新
3. 「预警中心 → 预警列表」查看分级预警与学生画像明细
4. 「系统操作中心 → 审计中心」查看操作审计日志

---

## 三、访问地址与端口

| 服务 | 地址 | 端口变量 |
|---|---|---|
| 管理端（Nginx + SPA） | http://localhost | `FRONTEND_HTTP_PORT=80` / `FRONTEND_PORT=8080` |
| 后端 API | http://localhost/api → 容器 3000 | `BACKEND_PORT=3000` |
| Adminer（可选 DB 客户端） | http://localhost:8081 | `ADMINER_PORT` |
| MinIO 控制台 | http://localhost:9101 | `MINIO_CONSOLE_PORT` |
| MinIO API | http://localhost:9100 | `MINIO_API_PORT` |
| MySQL（宿主机） | 127.0.0.1:3307 | `MYSQL_PORT` |
| Redis（宿主机） | 127.0.0.1:6380 | `REDIS_PORT` |

---

## 四、恢复已有数据（`261121` 分支 `db/` 目录）

`261121` 分支的 `db/` 目录带有最新脱库运行快照（MySQL 全量、Redis RDB、MinIO 对象），可按下面顺序恢复：

```bash
# 1) MySQL：结构 + 数据 + 例程 + 触发器
gunzip -c db/mysql/warnsys.sql.gz | docker compose exec -T mysql \
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 warnsys

# 2) Redis：RDB 快照
docker compose stop redis
docker cp db/redis/dump.rdb warnsys-redis:/data/dump.rdb
docker compose start redis

# 3) MinIO：bucket 原始数据
docker compose stop minio
docker run --rm -v "$(pwd)/db/minio/data:/src" -v warnsys-school_minio-data:/dst \
  alpine sh -c "cp -a /src/. /dst/"
docker compose start minio
```

详细基线行数见 `db/README.md`。

---

## 五、本地开发模式（改代码热更新）

```bash
# 1) 启动基础依赖
docker compose up -d mysql redis minio minio-init

# 2) 后端
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev                # http://localhost:3000

# 3) 管理端
cd admin-frontend
npm install
npm run dev                      # http://localhost:5173
```

Worker 单独启动：

```bash
cd backend && npm run worker:dev
```

---

## 六、项目目录结构（`261121` 分支）

```
.
├── backend/                  # NestJS API + Worker
│   ├── prisma/               # schema、migrations、seed
│   └── src/
│       ├── attendance/       # 签到（会话、二维码轮换、实时看板）
│       ├── warning/          # 预警计算与状态表
│       ├── warnings/         # 预警查询/统计视图
│       ├── warning-cases/    # 高风险干预工单
│       ├── rbac/             # 权限目录、守卫、用户级权限
│       └── ...               # users/classes/courses/orgs/audit/...
├── admin-frontend/           # Vue3 管理端（Claymorphism 绿系主题）
├── miniprogram/              # 微信小程序（仅供学生使用，Claymorphism 绿系主题）
├── db/                       # 最新运行数据快照（MySQL/Redis/MinIO）
├── docker-compose.yml        # 开发/单机编排
├── docker-compose.prod.yml   # 生产编排
└── .env.example              # 配置模板（复制为 .env）
```

---

## 七、许可与数据说明

- 私有项目，未附开源许可。
- `db/` 内为真实运行脱库数据（含学生姓名、学号、账号），仅限内部使用，禁止公开或外传。
- `.env` 与测试生产本地配置文件不建议公开传播，请妥善保管。
