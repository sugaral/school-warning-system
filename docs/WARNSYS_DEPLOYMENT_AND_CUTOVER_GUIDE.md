# 学业预警与考勤管理平台（Snowy v3.0.0 融合版）部署与增量割接交付手册

> **适用版本**：Snowy v3.0.0 + `snowy-plugin-biz`（M1~M5 全量完工基线）  
> **文档日期**：2026-11-25  

---

## 一、运行环境与端口矩阵

| 组件 | 容器 / 进程 | 端口 | 说明 |
|---|---|---|---|
| **MySQL 8.0.36** | `warnsys-mysql` | `3307`（宿主机）/ `3306`（内网） | 业务库 `snowy`（`utf8mb4_general_ci`）；原库 `warnsys` 全程只读 |
| **Redis** | `warnsys-redis` | `6380`（宿主机）/ `6379`（内网） | Sa-Token B/C 端会话与 Redisson 分布式锁（`database=1`） |
| **MinIO / Local** | `warnsys-minio` | `9100` / `9101` | 文件存储（容器内报表与C端附件支持 `LOCAL` + 鉴权流式下载） |
| **Snowy 后端** | `snowy-backend` | `82` | Spring Boot 3 / JDK 17（`TZ=Asia/Shanghai`，缓存 214+ 资源路由） |
| **Snowy 管理端** | `snowy-admin-web` | `81` | Vue3 + Vite + Ant Design Vue 4（`/api` 代理转发 `127.0.0.1:82`） |
| **微信小程序** | `miniprogram` | — | 原 UI 零改动，网络层直连 `/client/c/warnsys/**` + 国密 SM2 密文登录/改密 |

---

## 二、全量脚本与初始化执行顺序（幂等可重跑）

所有 SQL 脚本位于 [docs/sql/](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/) 目录：

1. **官方底座库导入**：`snowy_mysql.sql`（33 张系统表）
2. **业务 Schema 与基础初始化**：
   - [01_biz_warnsys_schema.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/01_biz_warnsys_schema.sql)（33 张 `BIZ_*` 业务表 + `BIZ_MIGRATION_ID_MAP`）
   - [02_biz_warnsys_init.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/02_biz_warnsys_init.sql)（学校根组织、5 大业务角色、`DEV_DICT`、4 个 `DEV_JOB`）
3. **历史数据迁移与国密标准化**：
   - [03_migrate_warnsys_to_snowy.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/03_migrate_warnsys_to_snowy.sql)（全量迁移 `warnsys` 38 张表数据，原库只读不改）
   - `MigrationCryptoStandardizer.java`（调用 `CommonCryptogramUtil` 将历史密码与手机号标准化为 SM3 + SM4-CBC）
   - [04_verify_migration.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/04_verify_migration.sql)（校验 42 项源/目标表零差异 + 8 项外键孤儿=0 + 剩余非 SM3=0）
4. **菜单、按钮与 `@SaCheckPermission` API 权限矩阵**：
   - M2 基础台账：`05_sys_resource_menus_m2_1.sql`、`06_sys_resource_menus_m2_2.sql`、`07_sys_resource_menus_m2_3.sql`
   - M3.1 考勤签到：`08_sys_resource_menus_m3_1.sql`
   - M3.2 预警工单：`09_sys_resource_menus_m3_2.sql`
   - M3.3 多角色工作台：[10_sys_resource_menus_m3_3.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/10_sys_resource_menus_m3_3.sql)
   - M3.4 统计通知报表：[11_sys_resource_menus_m3_4.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/11_sys_resource_menus_m3_4.sql)

---

## 三、后端打包与容器启动标准命令

### 3.1 Maven 全模块编译打包（Docker JDK 17）
> 注意：重新编译打包前需先停掉占用 `snowy-web-app-3.0.0.jar` 的容器并清理 `snowy-web-app/target`。

```powershell
docker rm -f snowy-backend 2>$null
Remove-Item -Recurse -Force "C:\Users\WS\Desktop\Snowy-master\snowy-web-app\target" -ErrorAction SilentlyContinue
docker run --rm -v "C:\Users\WS\Desktop\Snowy-master:/workspace" -v "$env:USERPROFILE\.m2:/root/.m2" -w /workspace maven:3.9-eclipse-temurin-17 mvn install -DskipTests -T 1C
```

### 3.2 启动后端容器（强制上海时区 `TZ=Asia/Shanghai`）

```powershell
docker run -d --name snowy-backend --network warnsys-school_default -p 82:82 -e TZ=Asia/Shanghai `
  -v "C:\Users\WS\Desktop\Snowy-master:/workspace" -w /workspace eclipse-temurin:17-jre `
  java -jar /workspace/snowy-web-app/target/snowy-web-app-3.0.0.jar --spring.profiles.active=local `
  --spring.datasource.dynamic.datasource.master.url="jdbc:mysql://warnsys-mysql:3306/snowy?useUnicode=true&characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true&nullCatalogMeansCurrent=true&useInformationSchema=true&rewriteBatchedStatements=true" `
  --spring.data.redis.host=warnsys-redis --spring.data.redis.port=6379
```

### 3.3 启动管理端前端

```powershell
cd C:\Users\WS\Desktop\Snowy-master\snowy-admin-web
npm install
npm run dev   # http://localhost:81，或 npm run build 生成生产 dist 托管至 Nginx
```

### 3.4 微信小程序生产发版前配置核对
- 编辑 [config.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/config.js)：确认 `ENV.prod.baseUrl` 指向备案 HTTPS 域名并反代至 Snowy 后端（`82` 端口），在微信公众平台将域名加入 `request` / `uploadFile` / `downloadFile` 合法域名。
- `ENV.dev.baseUrl` 已配置为 `http://localhost:82`，所有口令经 [smCrypto.js](file:///c:/Users/WS/Desktop/school-warning-system-master/miniprogram/utils/smCrypto.js) 自动 SM2 加密后传输至 `/client/c/warnsys/**`。

---

## 四、正式停机窗口增量割接与回滚预案

1. **割接窗口准备（T-10 分钟）**：停止旧 NestJS 服务写入入口，保持原库 `warnsys` 只读。
2. **二次增量全量校准**：
   - 在 `warnsys-mysql` 重跑 `03_migrate_warnsys_to_snowy.sql`（脚本按固定 Snowy 规则 ID 幂等对齐增量记录）。
   - 执行 `MigrationCryptoStandardizer` 补齐增量用户的 SM3 口令与 SM4-CBC 加密字段。
   - 重跑 `05` ~ `11` 号权限 SQL 确保菜单/按钮/接口权限无遗漏。
   - 执行 [04_verify_migration.sql](file:///C:/Users/WS/Desktop/Snowy-master/docs/sql/04_verify_migration.sql)，确认全部 42 项 `diff = 0`、外键孤儿 `= 0`、`PENDING_SM3 = 0`。
3. **切换流量与定时任务激活**：
   - 启动新版 `snowy-backend` + Nginx 发布 `snowy-admin-web/dist`。
   - 登录超管在 `系统调度 -> 定时任务` 按需启用 4 个已就绪的 `DEV_JOB`（自动开课/自动结课/每日预警扫描/异步通知分发）。
4. **回滚预案**：原 `warnsys` 库全程只读未修改；若需紧急回退，只需将 Nginx/小程序网关切回原 NestJS 服务端口，业务零丢失。

---

## 五、常用验证账号速查

| 端别 | 角色 | 登录账号 | 初始密码 | 数据作用域 |
|---|---|---|---|---|
| **B 端管理** | 超级管理员 | `superAdmin` / `12345678911` | `Snowy@2026!` | 全校（`SCOPE_ALL`） |
| **B 端学工** | 学工管理员 | `123456127` | `Snowy@2026!` | 本学院（`SCOPE_ORG_CHILD`） |
| **B 端院长** | 教学副院长 | `123456125` | `Snowy@2026!` | 本学院特批与风险监督 |
| **B 端教务** | 教务管理员 | `123456124` | `Snowy@2026!` | 课程/排课/成绩变更 |
| **B 端班主任** | 班主任 | `123456123` | `Snowy@2026!` | 绑班请假/初审/工单处理 |
| **B 端教师** | 任课教师 | `18181919245` | `Snowy@2026!` | 课堂签到与补录管理 |
| **C 端小程序** | 在籍学生 | `202600200201` | `123456789` | 仅限本人（`StpClientUtil`） |
