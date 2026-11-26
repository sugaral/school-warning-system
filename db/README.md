# 全量数据快照（MySQL / Redis / MinIO）

本目录保存 `261126_snowy` 分支全量运行数据快照，用于异地迁移或全新环境一键恢复。

| 文件 | 内容 | 说明 |
| :--- | :--- | :--- |
| `mysql/snowy.sql` | Snowy 业务主库全量 SQL（结构 + 数据 + 触发器 + 存储过程 + 事件） | `mysqldump --single-transaction --hex-blob --default-character-set=utf8mb4` |
| `mysql/snowy.sql.gz` | 同上 gzip 压缩包 | 快速导入用 |
| `mysql/warnsys.sql.gz` | 历史库 `warnsys` 全量备份（随实例一并留存） | `mysqldump` gzip 压缩 |
| `redis/dump.rdb` | Redis RDB 快照 | `redis-cli BGSAVE` 导出 |
| `minio/minio-data.tar.gz` | MinIO 原始 `/data` 数据卷完整归档（含 `warnsys-files` 与 `.minio.sys`） | `tar czf` 打包 |

---

## 一、`snowy` 主库核心表记录数（备份时刻基准，`DELETE_FLAG='NOT_DELETE'`）

- `SYS_USER`: 13 | `SYS_ORG`: 6 | `SYS_ROLE`: 7 | `CLIENT_USER`: 213
- `DEV_CONFIG`: 265 | `DEV_FILE`: 39 | `DEV_MESSAGE`: 1769
- `BIZ_STUDENT_PROFILE`: 213 | `BIZ_COURSE`: 21 | `BIZ_CLASS`: 5
- `BIZ_CLASS_SESSION`: 125 | `BIZ_ATTENDANCE_RECORD`: 4743
- `BIZ_WARNING`: 363 | `BIZ_WARNING_CASE`: 159
- `BIZ_NOTIFICATION_JOB`: 1116 | `BIZ_NOTIFICATION_LOG`: 1242
- `BIZ_EXPORT_JOB`: 111 | `BIZ_LEAVE_REQUEST`: 6 | `BIZ_APPEAL`: 3

---

## 二、新环境恢复步骤

### 1. 启动基础设施容器

```powershell
docker compose up -d
```

### 2. 恢复 MySQL（`snowy` 主库）

```bash
gunzip -c db/mysql/snowy.sql.gz | docker exec -i warnsys-mysql mysql -uroot -pf20c6f5fa6e763cd --default-character-set=utf8mb4
```

（若需恢复历史对比库 `warnsys`，可执行 `gunzip -c db/mysql/warnsys.sql.gz | docker exec -i warnsys-mysql mysql -uroot -pf20c6f5fa6e763cd --default-character-set=utf8mb4`。）

### 3. 恢复 Redis

```bash
docker stop warnsys-redis
docker cp db/redis/dump.rdb warnsys-redis:/data/dump.rdb
docker start warnsys-redis
```

### 4. 恢复 MinIO

```bash
docker stop warnsys-minio
docker run --rm -v warnsys-school_minio-data:/data -v "$(pwd)/db/minio:/src" alpine sh -c "rm -rf /data/* && tar xzf /src/minio-data.tar.gz -C /data"
docker start warnsys-minio
```

### 5. 一键编译并启动前后端

Windows 下直接执行仓库根目录脚本（首次需打包后端 JAR 可附加 `-RebuildJar`）：

```bat
start.bat -RebuildJar
```
