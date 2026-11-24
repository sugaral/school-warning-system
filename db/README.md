# 数据快照（MySQL / Redis / MinIO）

本目录保存系统当前的**运行数据**，用于换机、重建环境后快速恢复。
所有文件都是脱库副本，按二进制处理（见仓库根 `.gitattributes`）。

| 目录 | 内容 | 来源 |
|---|---|---|
| `mysql/warnsys.sql` | 完整逻辑备份（结构 + 数据 + 例程 + 触发器 + 事件），utf8mb4；2026-11-24 全量重新导出 | `mysqldump --single-transaction` |
| `mysql/warnsys.sql.gz` | 同上，gzip 压缩（约 340 KB） | 同上 |
| `redis/dump.rdb` | Redis RDB 快照（`BGSAVE` 最新导出） | `BGSAVE` 后从容器 `/data` 复制 |
| `redis/redis-appendonly.tar.gz` | AOF 目录 `appendonlydir/` 打包 | 同上 |
| `minio/data/` | MinIO 原始数据目录（`warnsys-files`、`warnsys-warning-queue`、`warnsys-warning-dlq` 三个 bucket 与 `.minio.sys` 元数据） | 直接复制容器 `/data` |

## 恢复步骤

### 1. MySQL

```bash
gunzip -c db/mysql/warnsys.sql.gz | docker exec -i warnsys-mysql \
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 warnsys
```

如果库还不存在，先建库：

```bash
docker exec -i warnsys-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "CREATE DATABASE IF NOT EXISTS warnsys DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

恢复后校验关键表行数（应与备份时一致）：

```sql
SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'permissions', COUNT(*) FROM permissions
UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions
UNION ALL SELECT 'user_permissions', COUNT(*) FROM user_permissions
UNION ALL SELECT 'warnings', COUNT(*) FROM warnings
UNION ALL SELECT 'warning_current_states', COUNT(*) FROM warning_current_states
UNION ALL SELECT 'attendance_records', COUNT(*) FROM attendance_records
UNION ALL SELECT 'class_sessions', COUNT(*) FROM class_sessions;
```

备份时刻的基线（2026-11-24 09:01）：`users 193`、`students 182`、`permissions 60`、`warning_rules 4`、`warnings 274`、`warning_current_states 274`、`attendance_records 851`、`class_sessions 22`。

> 2026-11-22 起，`warnsys` 库只保留本项目 Prisma 的 47 张表（+ `_prisma_migrations`），
> 原先混在库里的旧系统表（`EDU_*`、`SYS_*`、`DEV_*`、`BIZ_*`、`CLIENT_*`、`AUTH_THIRD_USER`、
> `GEN_*`、`MOBILE_RESOURCE` 共 47 张）已删除；删除前的备份见 `.artifacts/db-backup/legacy-tables.sql`（本地，不入库）。

### 2. Redis

停 Redis → 覆盖 RDB → 启动（RDB 是快照恢复最简单的方式）：

```bash
docker compose stop redis
docker cp db/redis/dump.rdb warnsys-redis:/data/dump.rdb
docker compose start redis
docker exec warnsys-redis redis-cli DBSIZE      # 期望 945
```

需要保留 AOF 时再叠加：

```bash
docker compose stop redis
docker cp db/redis/redis-appendonly.tar.gz warnsys-redis:/tmp/aof.tar.gz
docker exec warnsys-redis sh -c "cd /data && rm -rf appendonlydir && tar xzf /tmp/aof.tar.gz"
docker compose start redis
```

> 注意：Redis 里存的是会话、扫码 token、预警重算 stream。换机恢复后建议让用户重新登录，
> 避免旧会话与新的 `JWT_SECRET` 不匹配（.env 不入库，换机后是新密钥）。

### 3. MinIO

```bash
docker compose stop minio
docker run --rm -v "$(pwd)/db/minio/data:/src" -v warnsys-school_minio-data:/dst \
  alpine sh -c "cp -a /src/. /dst/"
docker compose start minio
```

然后确认三个 bucket 在位：

```bash
docker exec warnsys-minio-init sh -c "mc alias set local http://minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD && mc ls local"
```

## 说明

- 这些是**数据**，不是配置。`.env`（数据库口令、JWT 密钥、MinIO 账号）仍在本地且被 `.gitignore` 排除，换机后需按 `.env.example` 重新生成。
- 仓库已设为 **private**，但数据含真实学生信息与账号记录，转发/公开前请自行评估。
- 更新快照：重跑本目录的导出命令（见根 `README` 的「数据备份」一节），或直接：

```bash
docker exec warnsys-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events --no-tablespaces --default-character-set=utf8mb4 warnsys' | gzip -9 > db/mysql/warnsys.sql.gz
docker exec warnsys-redis redis-cli BGSAVE && sleep 3 && docker cp warnsys-redis:/data/dump.rdb db/redis/dump.rdb
docker cp warnsys-minio:/data db/minio/data
```
