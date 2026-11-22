# 学业预警系统（WARNSYS）

面向高校的学业预警与考勤闭环平台：教务排课 → 滚动二维码签到 → 缺勤/迟到/早退与学业指标汇总 → 多级预警（黄/橙/红/严重）→ 高风险干预工单 → 申诉/请假/补卡审批 → 多维统计导出与审计留痕。

> **分支说明**：
> - `master` 分支仅保留 `README.md` 与按时间戳归档的**更新记录**。
> - `261122` 分支保存最新完整项目源码、一键启停脚本与运行数据快照（本文件仅保留系统详细介绍）。
> - `261121` 分支保存截至 `2026-11-21` 的历史归档版本。

---

## 一、系统架构与技术栈

| 分层 | 技术栈与定位 | 说明 |
|---|---|---|
| 后端 API 与后台 Worker | NestJS 11 + TypeScript + Prisma 5 | API 服务（`dist/main.js`）与独立 Worker（`dist/worker.js`）分离部署 |
| 数据与缓存存储 | MySQL 8.0.36 + Redis 7.2 + MinIO | 关系型主库 + Redis Streams 异步重算队列/分布式锁 + 对象存储 |
| Web 管理端 | Vue 3 + Vite + Element Plus + ECharts | Claymorphism 绿系软陶主题，支持全局自适应表格与多角色菜单 |
| 微信小程序端 | 原生微信小程序（`miniprogram/`） | 面向学生使用，Claymorphism 绿系主题 + 液态玻璃分段/悬浮底栏 |
| 部署与网关 | Docker Compose + Nginx | 提供单机与生产编排，Nginx 托管前端静态资源并反代后端 `/api` |

---

## 二、核心功能模块介绍

### 1. 组织与教务基础
- **组织与人员管理**：维护学校/学院层级（`orgs`）、专业与班级（`classes`）、教师与学生档案（`teachers` / `students`），支持学籍状态变更与班主任/教师授课绑定。
- **课程、排课与成绩**：维护学期起始校历设置（`semester-settings`）、课程与开课班（`course-classes`）、周次课表（`schedules`）及课程成绩、学分与 GPA 管理（`grades-manage`）。

### 2. 智能考勤与二维码签到
- **滚动二维码签到**：管理员或任课/班主任教师可创建课次并开启签到看板，二维码按配置周期自动轮换；看板实时轮询展示应到、已到、迟到、请假人数及已签/未签明细。
- **学生扫码与补录调整**：学生端小程序拉起扫码并校验动态口令与位置权限完成打卡；管理员/教师支持手工调整单个学生考勤状态或录入课堂日记录。
- **自动结算与统计快照**：支持单次提前结束、批量结束与 Worker 秒级到点自动结算，自动为未签到学生区分已批准请假与缺勤并写入考勤/日报记录，同步维护 `class_session_snapshots` 课次统计快照。

### 3. 多窗口分级预警引擎与干预闭环
- **多指标与分级规则**：支持迟到（`late`）、缺勤（`absent`）、早退（`early_leave`）、作业、课堂表现以及学期挂科数/学分/GPA 等指标，支持学校、学院、班级三级覆盖规则与日/周/月/学期时间窗。
- **实时与批量计算**：结束签到或批量结算后触发内存聚合计算，支持跨窗口自动升级与原地状态维护（活跃状态表 `warning_current_states` + 历史留痕表 `warnings` + 学生统计快照 `student_warning_snapshots`）。
- **班级预警中心与高风险干预**：按学院、专业、班级、关键字检索全班学生画像与课程聚合明细；支持学生/管理员双端确认预警、触发高风险干预工单（指派、受理、办结闭环）及站内信/邮件策略分发。

### 4. 审批、统计报表与系统治理
- **审批中心**：统一处理学生提交的请假申请、补录申请与预警申诉；审批通过后自动关联更新考勤/预警状态并触发异步重算。
- **统计看板与异步导出**：提供学院与全校级预警统计图表（按“有预警 ∪ 有学生”统计全量院系），支持按数据范围可见的异步 Excel 报表生成（由 `worker` 生成并存入 MinIO）。
- **RBAC 权限、审计与安全**：支持 9 类角色视图（系统管理员、教务管理员、教学副院长、学工管理员、班主任、任课教师、班干部、学生等）与 60 项细粒度权限；内置接口 DataScope 隔离、Redis 幂等拦截、登录限流/验证码、文件魔数校验与敏感字段脱敏审计日志。

### 5. 微信小程序（纯学生端）
- 内置 24 个页面与悬浮玻璃底部导航（首页、我的预警、课表、我的），覆盖扫码签到、实时考勤记录、学期课表、成绩与学期汇总、我的预警确认与一键转申诉、请假与凭证图片预览、班级通知与个人站内信、个人资料与通知偏好设置。

---

## 三、前置要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Docker Desktop | 24+（含 Compose v2） | 一键拉起 MySQL / Redis / MinIO / 后端 / Worker / 前端 |
| Node.js | 20 LTS | 仅在「本地开发模式」需要 |
| 操作系统 | Windows 10/11、macOS、Linux | Windows 提供一键启停脚本，其它系统使用 Docker Compose |

确认环境：

```bash
docker --version && docker compose version
node -v    # 可选，本地开发才需要
```

---

## 四、快速启动

### 方式 A：Windows 一键启停（推荐）

根目录下提供 `start.bat` / `start.ps1` 与 `stop.bat` / `stop.ps1`：

```powershell
# 默认混合极速模式：Docker 启动 MySQL/Redis/MinIO，本机运行前后端（自动生成 backend/.env 硬链接）
.\start.bat

# 全容器启动 / 强制重编译 / 后端热重载开发模式
.\start.bat -Docker
.\start.bat -Rebuild
.\start.bat -Dev

# 一键停止：默认停止本地进程并 docker compose stop（保留容器与数据卷，下次秒起）
.\stop.bat
.\stop.bat -Purge       # 移除容器与网络（仍保留数据卷）
.\stop.bat -KeepDocker  # 仅停止本地 Node 进程，保留容器运行
```

### 方式 B：Docker Compose 从 0 启动（5 步）

1. **准备配置**（根目录 `.env` 为唯一配置源，已忽略不入库）：

   ```bash
   cp .env.example .env
   ```

   至少修改以下配置项：

   ```ini
   MYSQL_ROOT_PASSWORD=换成你的强口令
   MYSQL_PASSWORD=改成同样的值（与 DATABASE_URL 里保持一致）
   DATABASE_URL=mysql://warnuser:你的MYSQL_PASSWORD@mysql:3306/warnsys

   JWT_SECRET=至少32位随机串
   MINIO_ROOT_PASSWORD=换成你的口令
   MINIO_SECRET_KEY=与 MINIO_ROOT_PASSWORD 相同

   WARNING_BASELINE_DATE=2026-11-19   # 预警统计起点，早于该日期的数据不计入
   ```

2. **拉起全部容器**：

   ```bash
   docker compose up -d --build
   ```

   首次会依次完成镜像构建、依赖服务启动、`minio-init` 创建存储桶、`migrate` 执行 `prisma migrate deploy`（失败则 `db push`），以及启动 `backend` / `worker` / `frontend`。

3. **等待健康就绪**：

   ```bash
   docker compose ps
   ```

   期望 `warnsys-mysql / warnsys-redis / warnsys-minio / warnsys-backend / warnsys-worker / warnsys-frontend` 均为 `Up (healthy)`。

4. **登录与初始化数据**：

   浏览器打开 **http://localhost**（自动跳到 `/login`）。如需恢复脱库数据见第六节；若为空库首次初始化 seed，需显式开启授权环境变量后再执行（默认禁用破坏性清库重置）。

5. **验证主链路**：

   - 「课程课次」建课并开课 → 「签到明细」新建课次 → 打开签到看板（二维码轮换 + 已签/未签）
   - 学生通过小程序扫码签到 → 看板实时刷新
   - 「预警中心 → 预警列表」查看班级花名册与课程聚合明细
   - 「系统操作中心 → 审计中心」查看操作审计日志

---

## 五、访问地址与端口

| 服务 | 地址 | 端口变量 |
|---|---|---|
| 管理端（Nginx + SPA） | http://localhost（或 http://localhost:8080） | `FRONTEND_HTTP_PORT=80` / `FRONTEND_PORT=8080` |
| 本地 Vite 开发端 | http://127.0.0.1:5173 | 默认 `5173` |
| 后端 API | http://localhost/api → 容器 3000 | `BACKEND_PORT=3000` |
| Adminer（可选 DB 客户端） | http://localhost:8081 | `ADMINER_PORT` |
| MinIO 控制台 | http://localhost:9101 | `MINIO_CONSOLE_PORT` |
| MinIO API | http://localhost:9100 | `MINIO_API_PORT` |
| MySQL（宿主机） | 127.0.0.1:3307 | `MYSQL_PORT` |
| Redis（宿主机） | 127.0.0.1:6380 | `REDIS_PORT` |

---

## 六、恢复已有数据（`db/` 目录）

本分支 `db/` 目录包含脱库运行快照（MySQL 逻辑备份、Redis RDB/AOF 快照、MinIO 对象文件），可按以下顺序恢复：

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

详细基线行数与说明见 [db/README.md](db/README.md)。

---

## 七、本地开发模式（改代码热更新）

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
npm run dev                      # http://127.0.0.1:5173
```

Worker 单独启动：

```bash
cd backend && npm run worker:dev
```

---

## 八、项目目录结构

```text
.
├── backend/                  # NestJS API + Worker
│   ├── prisma/               # schema、migrations、seed
│   └── src/
│       ├── attendance/       # 签到会话、二维码轮换、统计快照
│       ├── warning/          # 多窗口预警引擎、异步队列与状态快照
│       ├── warnings/         # 班级预警视图与管理接口
│       ├── warning-cases/    # 高风险干预工单
│       ├── scheduler/        # 签到到点自动结算与恢复扫描
│       ├── rbac/             # 角色、数据范围与用户级权限
│       └── ...               # auth/users/classes/courses/orgs/reports/audit/...
├── admin-frontend/           # Vue 3 管理端（Claymorphism 绿系主题）
├── miniprogram/              # 微信小程序（纯学生端，Claymorphism 绿系主题）
├── db/                       # 脱库运行数据快照（MySQL / Redis / MinIO）
├── docs/                     # 变更说明等项目文档
├── start.bat / start.ps1     # Windows 一键启动脚本
├── stop.bat / stop.ps1       # Windows 一键停止脚本
├── docker-compose.yml        # 开发 / 单机 Docker Compose 编排
├── docker-compose.prod.yml   # 生产 Docker Compose 编排
└── .env.example              # 环境配置模板（复制为根目录 .env）
```

---

## 九、许可与数据说明

- 私有项目，未附开源许可。
- `db/` 内为脱库运行数据（含学生姓名、学号、账号），仅限内部使用，禁止公开或外传。
- `.env` 与本地测试配置文件不进入版本库，请妥善保管。
