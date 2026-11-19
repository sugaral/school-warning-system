# 预警系统重做 · 第一批落地记录

> 目标场景：**100 个班级同时下课，每班 40 人，一半缺勤（2000 条缺勤）**。
> 要求：及时落库、不多不少、管理端及时同步。

本文件记录本轮实际改了什么、怎么验证、还剩什么没做。

---

## 一、结论（实测）

| 指标 | 改造前 | 改造后（实测） |
|---|---|---|
| 课次到期 → 缺勤落库 | 最坏 **5 分钟**（轮询） | **1118 ms**（首条）+ **1217 ms**（全部 2000 条） |
| 缺勤条数 | 逐班逐事务、易重复/遗漏 | **2000 / 2000**，重复 0 |
| 课次状态 | 手动/定时三方并发可重复结算 | 100/100 `ended`，CAS 只允许一次 |
| 日报缺勤 | 依赖 skipDuplicates 可能折叠 | **2000** 条一致 |
| 活跃预警列表 | `warning_current_states` 被误删 → **0 行** | **2000**（负载测试）/ **211**（修复后真实数据） |
| 重复预警 | 每次重算 append → 实测 149 条重复 | **0** |
| 预警入队 | 2000 次串行 `SET NX`，实测卡在第 280 个 | pipeline 一次往返，**enqueued=2000** |
| 死信 | 进 DLQ 后永久躺着 | 每 10 分钟自动回灌 |
| 双调度器 | API + worker 各跑一份 @Cron | 只有 worker 跑 |

负载测试脚本：`scripts/loadtest_100x40_fixture.sql`（造数）、`scripts/loadtest_watch.ps1`（观测）、
`scripts/loadtest_cleanup.sql`（清理）、`scripts/repair_warning_current_states.sql`（数据修复）。

---

## 二、新增：课次到点自动结算（实时缺勤）

文件：`backend/src/scheduler/session-auto-close.service.ts`

- 每 `ATTENDANCE_AUTO_CLOSE_INTERVAL_MS`（默认 1000ms）扫一次
  `status='active' AND (session_end < now() OR qr_expire_at < now())`，命中已有索引 `(status, session_end)` / `(status, qr_expire_at)`。
- 多实例只让拿到 Redis 锁 `lock:attendance:auto-close` 的实例干活。
- 一批到期课次**整批结算**：
  1. 一次 `updateMany({ id in [...], status: 'active' })` 做 CAS；
  2. 一次查齐这批课次的已有考勤；
  3. 一次查齐请假，内存里按课次过滤；
  4. `createMany` 500 行/批写考勤 + 日报；
  5. 按 `(course_id, record_date)` 分组 `updateMany` 纠正日报状态；
  6. Redis pipeline 写读镜像 `attendance:live:session:{id}`（TTL 600s，只给前端秒开）；
  7. **结算完成后**才把预警目标统一入队，避免与结算抢数据库连接。
- 正确性兜底：`attendance_records @@unique([session_id, student_id])` + CAS，重复结算不会多写。

配置（`.env` / `docker-compose.yml`）：

```
ATTENDANCE_AUTO_CLOSE_ENABLED_WORKER=true   # API 侧默认 false
ATTENDANCE_AUTO_CLOSE_INTERVAL_MS=1000
ATTENDANCE_AUTO_CLOSE_BATCH=200
ATTENDANCE_SCHEDULER_ENABLED_API=false      # 定时任务单实例
ATTENDANCE_SCHEDULER_ENABLED_WORKER=true
WARNING_QUEUE_DLQ_REPLAY_LIMIT=100
```

> 旧的 5 分钟扫描保留作为兜底（只修漏，不再承担主路径）。

---

## 三、修掉的缺陷

### P0-1 跨表 id 误删（`warning.service.ts`）

日窗口路径从 `warnings` 取行，却传给 `closeCurrentWarningStates()`，
而后者执行的是 `warning_current_states.deleteMany({ id: { in: [...] } })`。
两张表 id 各自从 1 自增、区间重叠 → 按 `warnings` 的 id 删掉毫不相干的 current_states，
并把它们当 closed 再 append 一遍。

**证据**：改造前 `warnings(status=open)=360`，`warning_current_states=0`，管理端活跃列表恒空。

**修复**：日窗口路径改用 `closeWarnings()`；历史脏数据用 `scripts/repair_warning_current_states.sql` 重建（211 条 state），并合并 149 条重复。

### P0-2 批内失败静默丢弃（`warning-queue.service.ts`）

`generateWarningsForAffectedRecords()` 默认 `failOnError=false`，单学生异常只打日志，
随后仍然 `clearPendingKeys + XACK + XDEL` → 这批学生永久丢失。

**修复**：改调 `generateWarningsForAffectedRecordsWithOptions(..., { failOnError: true })`；
`targets_locked > 0` 也当失败抛出，走现有重试/DLQ 通道（不会再 ACK 掉）。

### P0-3 去重键串行 + 单消息过大（`warning-queue.service.ts`）

2000 个 `SET NX` 串行，实测在第 280 个卡住，导致整批不入队。
**修复**：改为一次 `pipeline` 往返；`enqueued=2000 deduped=0`。

### P0-5 双调度器（`attendance-scheduler.service.ts`）

API 与 worker 复用同一 `AppModule`，`@Cron` 各跑一份。
**修复**：`ATTENDANCE_SCHEDULER_ENABLED` 门控，API 容器默认关闭（日志已确认：
`当前实例未启用签到扫描调度`）。

### P0-6 主路径不标记 settled

`processEndedSessionsInternal()` 里 `sessionsToSettle` 从未 `add`，
于是 27/57 恢复扫描把已处理课次当"未结算"再派发。
**修复**：成功结算后补 `sessionsToSettle.add(...)`。

### 幂等：无变化不再 append 历史（`warning.service.ts`）

`syncWarningState()` 每次重算都 `update + appendWarningHistory`，
队列重投/恢复扫描一多就堆积重复。
**修复**：级别、规则、计数、摘要、触发详情指纹全等时直接返回，不再写。

### 新增：死信自动回灌（`warning-queue.service.ts` + scheduler cron）

`replayDeadLetters(limit)`：从 `stream:warning:recalc:dlq` 读条目，还原 payload
（inline / MinIO snapshot 两种形态都支持），重新投回主队列后删除。
每 10 分钟执行一次，上限 `WARNING_QUEUE_DLQ_REPLAY_LIMIT`。

---

## 四、实测数据（100 班 × 40 人 × 100 课次）

```
deadline → 首条缺勤      1118 ms
deadline → 全部 2000 条  1217 ms
① on_time               2000
② absent                2000
③ 考勤总行数             4000
④ 重复(session,student)   0
⑤ 课次 ended            100
⑥ 日报 absent           2000
⑦ day/open 预警          2000
⑧ current_states        2000   ← P0-1 修复生效
⑨ 重复预警                0
```

预警入队日志：`mode=queued enqueued=2000 deduped=0 目标=2000`。
预警重算在结算之后进行，2000 人大约 45 秒完成（每人 6 个事务、并发 12），
不影响"缺勤可见"的 1.2 秒。

---

## 五、还没做（下一批）

| 项 | 现状 | 计划 |
|---|---|---|
| 每学生 6 个事务 | 185ms/人，2000 人 ≈ 45s | 合并成 1 事务 + 按班批量 upsert，目标 ≤ 5s |
| `warnings.event_key` 唯一键 | 未加 | 迁移 + 回填 + 唯一索引，从数据库层杜绝重复 |
| 管理端读镜像 | 只写了 `attendance:live:session:{id}`，接口还在读库 | 接口优先读镜像 + 写后精确失效 |
| 快照同事务 | 仍异步刷新 | 与预警写入同事务更新 `student_warning_snapshots` |
| 死信回灌演练 | 代码已就绪，未做故障注入 | kill worker / 人为制造失败，验证不丢不重 |
| 时区口径 | Prisma 存 UTC，MySQL `NOW()` 是 +08:00 | 统一用 `UTC_TIMESTAMP()` 或显式时区，避免 8 小时错位（压测时已踩到） |

---

## 六、回归提醒

- 手动结束课次（`POST /attendance/sessions/:id/end`）现在返回 `changed=false` 时回 `签到已结束`，
  不再重复补缺勤。
- 若宿主 80 端口被占用，前端映射用 `FRONTEND_HTTP_PORT` 覆盖。
- 压测脚本会写入 `LOADTEST-*` / `LT*` 数据，务必用 `scripts/loadtest_cleanup.sql` 清理。

---

## 七、方案 A：预警「次数」改为读时聚合（2026-11-19）

### 7.1 问题现象

同一学生、同一日期、同一课程连续多节课全缺勤时，管理端「预警列表」只显示 1 条缺勤记录，次数恒为 1。

### 7.2 根因

`warning_current_states` 的唯一索引 `uq_warn_cur_state_course` 是
`(student_id, metric, window, period_start, period_end, course_key)`，**不含 session 维度**。
同一天同一课程的 N 节异常课在写入时被合并成 1 行，`current_count` 被最后一次写入覆盖为 1。

复现（改造前）：

```
同一班级 + 同一课程 + 同一天，连续 2 个课次全员缺勤，各自结束：
warnings（历史表）      = 62 行（每课次 31 行）
warning_current_states  = 31 行（每学生 1 行，current_count = 1）
```

### 7.3 改法（只读聚合，不动预警状态机）

| 位置 | 改动 |
|---|---|
| `warnings.controller.ts` 新增 `loadOccurrenceCountsByStudent()` | 批量按 `COUNT(DISTINCT session_id)` 统计多名学生在周期内的异常课次数 |
| `warnings.controller.ts` 新增 `loadOccurrenceCountsByCourse()` | 单人版，按 `(course, metric)` 维度统计，供详情使用 |
| `GET /warnings/class-view/students` | 每个学生增加 `occurrence_total`（本周异常课次数） |
| `GET /warnings/class-view/students/:id/detail` | `summary.occurrence_total` + 每个 `course_groups[].occurrence_count` + 每条 `warning_items[].occurrence_count` |
| `warning-snapshot.service.ts` | 详情/列表缓存 key 由 `v3` 升到 `v4`，避免旧结构缓存命中 |
| `Warnings.vue` | 学生列表行显示「本周异常 N 次课」；「当前预警条数」卡片加小字「本周期异常 N 次课」；课程卡显示「本周期异常 N 次课」 |

语义约定：
- **预警条数**（`warning_count`）= 当前态预警行数，仍按 (学生, 课程, 周期) 聚合，不会因多节课膨胀
- **异常次数**（`occurrence_count` / `occurrence_total`）= 真实发生的课次数，`COUNT(DISTINCT session_id)`，只读事实表 `attendance_records`

### 7.4 顺带修掉的两个数据缺陷

1. **`course_key` 双口径**：`getCourseKey()` 产出 `9` / `__none__`，而日批量路径
   （`warning.service.ts` 的 `currentStateRows`）写成 `course_9` / `''`。
   两套 key 让同一学生同一课程在 `current_states` 出现两份 → 「当前预警条数」翻倍
   （实测 open warnings 273 vs states 304）。已改为统一走 `this.getCourseKey()`，
   并把历史数据 `course_*` → 裸 id、`''` → `__none__`，重复行按 key 保留最新。
2. **状态与预警数量对不上**：清理后 `open warnings = 273`、`current_states = 273`，一致。

### 7.5 验收

```
detail(day)  student=630 : warning_count=1（计算机组成原理） occurrence_count=3   ← 3 节课全缺
                          warning_count=1（计算机网络）     occurrence_count=1
                          summary.occurrence_total=4
list(class=3): occurrence_total=2（清理测试课次后回落到 2：课程9 ×1 + 课程10 ×1）
清理 812/813 后：occurrence_total 4 → 2，验证计数随事实表实时变化
```

### 7.6 未做（后续可选项）

- 若希望列表按「课次」分行展示（4 节课 = 4 条记录），需要改 `uq_warn_cur_state_course`
  加入 `session_key` 并做历史回填；当前方案选择不引入该迁移。
- 「累计」跨周期口径（学期重置）尚未实现，目前只呈现「本周期」次数。