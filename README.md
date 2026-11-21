# 学业预警系统（WARNSYS）

面向高校的学业预警与考勤闭环平台：教务排课 → 二维码签到 → 缺勤/迟到/早退自动汇总 → 多级预警（黄/橙/红/严重）→ 高风险干预工单 → 审计留痕。

- **后端**：NestJS 10 + Prisma 5 + MySQL 8.0.36 + Redis 7.2（Streams 队列）+ MinIO
- **管理端**：Vue 3 + Vite + Element Plus（Claymorphism 绿系软陶主题、滑动页签、按用户分配权限）
- **小程序**：`miniprogram/` 纯学生端（Claymorphism 绿系软陶主题，支持签到、课表、预警确认/申诉、请假、成绩与双通道消息）
- **部署**：Docker Compose（dev / prod 两套），Nginx 同时托管 SPA 与 `/api` 反代

> **分支说明**：
> - `master` 分支仅保留本 `README.md`（含项目说明与按时间戳归档的更新记录）。
> - `261121` 分支保存截至 `2026-11-21` 的完整项目源码、安全与性能优化及最新数据库快照。

---

## 更新记录（按时间戳分类）

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
