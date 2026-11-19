# 学业预警系统（WARNSYS）

面向高校的学业预警与考勤闭环平台：教务排课 → 二维码签到 → 缺勤/迟到/早退自动汇总 → 多级预警（黄/橙/红/严重）→ 高风险干预工单 → 审计留痕。

- **后端**：NestJS 10 + Prisma 5 + MySQL 8.0.36 + Redis 7.2（Streams 队列）+ MinIO
- **管理端**：Vue 3 + Vite + Element Plus（Claymorphism 主题、滑动页签、按用户分配权限）
- **小程序**：`miniprogram/` 学生端签到与查询
- **部署**：Docker Compose（dev / prod 两套），Nginx 同时托管 SPA 与 `/api` 反代

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

首次会依次完成：拉镜像 → 编译后端（`prisma generate` + `tsc`）→ 打前端镜像 → 启动 MySQL/Redis/MinIO → `minio-init` 建 bucket → `migrate` 执行 `prisma migrate deploy`（失败则 `db push`）并跑 `seed` → 启动 `backend` / `worker` / `frontend`。

首次构建 3~8 分钟属正常，之后增量重建在 30 秒内。

### 3. 等待健康

```bash
docker compose ps
```

期望看到 `warnsys-mysql / warnsys-redis / warnsys-minio / warnsys-backend / warnsys-worker / warnsys-frontend` 都是 `Up (healthy)`。

如果不健康，看日志定位：

```bash
docker compose logs --tail=100 migrate    # 建表/seed 阶段报错多半在这里
docker compose logs --tail=100 backend
```

### 4. 登录

浏览器打开 **http://localhost**（会自动跳到 `/login`）。

| 角色 | 账号 | 密码 |
|---|---|---|
| 超级管理员 | `13800138000` | `admin123` |
| 教师 | `13800138001` | `teacher123` |
| 学工 | `13800138003` | `staff123` |

> 这是 `backend/prisma/seed.ts` 建的初始账号。**上线前务必改密码**：登录后进「系统管理 → 用户管理 → 重置密码」，或
> `docker compose exec backend npx ts-node prisma/update-password.ts`。

### 5. 验证主链路

1. 「课程课次」建一门课 + 一个开课班 → 「签到明细」新建课次 → 打开签到看板（二维码 + 已签/未签）
2. 学生扫码签到（或小程序）→ 看板 2 秒内刷新
3. 「预警中心 → 预警列表」应出现黄色预警；点学生看右侧画像与按课程聚合的明细
4. 「系统操作中心 → 审计中心」能看到刚才的操作日志

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

## 四、恢复已有数据（可选）

仓库 `db/` 里带了一份脱库快照（MySQL 全量、Redis RDB/AOF、MinIO 对象），需要「接着上次的数据跑」时按下面顺序灌入；只要空库从 0 起，跳过本节即可。

```bash
# 1) MySQL：结构 + 数据 + 例程 + 触发器
gunzip -c db/mysql/warnsys.sql.gz | docker compose exec -T mysql \
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 warnsys

# 2) Redis：RDB 快照（会话/签到 token/预警重算 stream）
docker compose stop redis
docker cp db/redis/dump.rdb warnsys-redis:/data/dump.rdb
docker compose start redis
docker compose exec redis redis-cli DBSIZE      # 期望 945

# 3) MinIO：三个 bucket 原始数据
docker compose stop minio
docker run --rm -v "$(pwd)/db/minio/data:/src" -v warnsys-school_minio-data:/dst \
  alpine sh -c "cp -a /src/. /dst/"
docker compose start minio
```

> 卷名规则是 `<compose 项目名>_minio-data`，本项目为 `warnsys-school_minio-data`；
> 若不匹配，用 `docker volume ls | grep minio-data` 查实际名字后替换。
> 详细说明与基线行数见 [`db/README.md`](db/README.md)。

---

## 五、本地开发模式（改代码热更新）

容器只跑依赖（MySQL / Redis / MinIO），前后端在宿主机跑：

```bash
# 1) 只启动依赖
docker compose up -d mysql redis minio minio-init

# 2) 后端（Nest，热重载）
cd backend
npm install
npx prisma generate
npx prisma migrate deploy        # 或 prisma db push
npm run prisma:seed              # 首次需要初始数据
npm run start:dev                # http://localhost:3000

# 3) 另一个终端：管理端（Vite）
cd admin-frontend
npm install
npm run dev                      # http://localhost:5173
```

Vite 已配好 `/api`、`/admin`、`/attendance` 等前缀到 `http://localhost:3000` 的代理（见 `admin-frontend/vite.config.ts`），前端直接用相对路径请求即可。

Worker（队列消费）单独起：

```bash
cd backend && npm run worker:dev
```

---

## 六、常用运维命令

```bash
docker compose ps                          # 状态与健康
docker compose logs -f backend worker      # 追日志
docker compose restart backend worker      # 改完后端代码后（容器模式）
docker compose down                        # 停止（保留数据卷）
docker compose down -v                     # 停止并删数据卷（等于清库，慎用）

# 只重建前端（改了 admin-frontend）
docker compose build frontend && docker compose up -d --no-deps frontend

# 数据库备份（文本快照）
docker compose exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction --routines --triggers --events --no-tablespaces \
  --default-character-set=utf8mb4 warnsys' | gzip -9 > db/mysql/warnsys.sql.gz
```

仓库还带一批开发脚本：`dev-up.*`（构建+启动+健康检查）、`dev-down.*`、`dev-reset.*`（重置库与卷）、`deploy-all.sh`（生产部署）。Windows 用 `.cmd` / `.ps1`，Linux/macOS 用 `.sh`。

---

## 七、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `docker compose up` 卡在 migrate | 看 `docker compose logs migrate`；多为 `.env` 里 `DATABASE_URL` 与 `MYSQL_PASSWORD` 不一致 |
| 后端 401 / 一直跳登录 | `JWT_SECRET` 改过但 Redis 里存着旧会话，`docker compose restart redis` 后重新登录 |
| 页面刷新 404（如 `/attendance`） | Nginx 需回 SPA：确认 `admin-frontend/nginx.conf` 的 `try_files ... /index.html` 与 Accept 判断未被改动 |
| 改了前端但页面没变化 | HTML 已设 `no-store`，仍异常则 Ctrl+F5；确认 `docker compose build frontend` 真的重建了 |
| 接口偶发 403 权限不足 | 该账号权限被「按用户分配」覆盖，去「系统管理 → 权限管理」检查；超管不受限制 |
| 时间差 8 小时 | 容器统一 `TZ=Asia/Shanghai`；直接写 SQL 造数据请用 `UTC_TIMESTAMP(3)`（Prisma 存 UTC） |
| 端口被占用 | 改 `.env` 的 `MYSQL_PORT / REDIS_PORT / MINIO_API_PORT / FRONTEND_PORT / BACKEND_PORT` |
| 预警列表为空 | 检查 `.env` 的 `WARNING_BASELINE_DATE`，早于该日期的签到不计入预警 |

---

## 八、目录结构

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
├── admin-frontend/           # Vue3 管理端（含 nginx.conf）
│   └── src/styles/           # clay-theme.css（全局主题）
├── miniprogram/              # 学生端小程序
├── db/                       # 数据快照（MySQL/Redis/MinIO）+ 恢复说明
├── docs/                     # 设计与修复记录、截图
├── scripts/                  # 运维与校验脚本
├── docker-compose.yml        # 开发/单机编排
├── docker-compose.prod.yml   # 生产编排
└── .env.example              # 配置模板（复制为 .env）
```

---

## 九、许可与数据说明

- 私有项目，未附开源许可。
- `db/` 内为**真实脱库数据**（含学生姓名、学号、账号），仅限内部使用，禁止外传或公开。
- `.env`（数据库口令、JWT 密钥、MinIO 账号）不入库，请单独保管。
