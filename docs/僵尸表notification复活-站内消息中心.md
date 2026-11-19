# 僵尸表 `notification` 复活 —— 站内消息中心

> 本文记录 `notification` 表从"只被删、从没被写"到成为可用站内消息中心的
> 全过程，以及过程中发现的**两个会真实触达学生的缺陷**。

## 1. 修复前的状态（僵尸表）

`notification` 表结构完整（user_id / type / content / status / created_at），
但全仓库搜索 `prisma.notification.create` —— **0 命中**。

唯一一处引用是 `users.controller.ts:334`：

```ts
await tx.notification.deleteMany({ where: { user_id: userId } });
```

也就是说这张表**只会被删，从来没有被写过**。

与此同时前端 `pages/student/MyNotifications.vue` 调用
`GET /student/notifications` —— 但该路由实际读的是 `class_notifications`
（班级公告，`students.controller.ts:2869`），与 `notification` 表无关。

**业务后果**：学生端没有任何"针对我个人的"站内消息能力。
预警触达只能依赖 email / sms / wechat 这些**外部渠道**；
而本项目默认没有 SMTP、没有短信网关，wechat/wecom 也未实现 ——
于是学生在系统里**什么都收不到**。

## 2. 落地内容

### 2.1 服务层 `shared/notification-center.service.ts`

| 能力 | 方法 |
| --- | --- |
| 单条写入（尽力而为，失败只记日志） | `createForUser` |
| 批量写入（createMany，失败降级逐条） | `createManyForUsers` |
| 未读数 | `countUnread` |
| 分页列表 + type_label | `listForUser` |
| 单条已读（带 user_id 条件防越权） | `markRead` |
| 全部已读 | `markAllRead` |
| 每日 04:10 清理（**只删已读**超期） | `cleanupOldNotifications` |

级别 → 类型映射：`warning_{yellow|orange|red|severe}`，未知级别降级 `system`。

### 2.2 接口层 `shared/notification-center.controller.ts`

沿用前端既有约定（`/student/*`），但使用独立子路径避免与
`StudentsController` 已注册的 `GET /student/notifications`（班级公告）冲突：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/student/inbox` | 列表（支持 `status`/`type` 筛选、分页） |
| GET | `/student/inbox/unread-count` | 未读数（前端红点轮询） |
| POST | `/student/inbox/read-all` | 全部已读（声明在 `:id/read` 之前） |
| POST | `/student/inbox/:id/read` | 单条已读 |

安全约束：`markRead` 的 where 同时带 `id` 与 `user_id`，
标记他人消息返回 **404**（不泄露存在性），非法 ID 返回 400。

### 2.3 写入接入点

1. **预警生成时**（`warning.service.ts` `writeInAppWarningNotification`）
   —— 在外部渠道循环**之前**写一次，与"发不发邮件"解耦，保证
   "预警一定能在系统里看到"。
2. **班级公告发布时**（`class-monitor.controller.ts`）
   —— 给班内每个学生各写一条 `class_notice`，学生端即可通过未读数感知。
   失败不影响公告发布。
3. **app 渠道派发**（见下）

### 2.4 `app` 渠道从"未实现"变为真实可用

`deferUnsupportedChannel` 的注释原本写着
「`app`：站内信（notification 表），未实现」。现在：

- `resolveNotificationChannels` 把 `app` 纳入可配置渠道白名单；
- **并且无条件加入**：只要学生有 `users.id` 就一定排一条 app 任务。
  理由是站内信是唯一零外部依赖的渠道，是"预警可达"的兜底；
- `receivers_json` 增加 `user_id` 字段，派发侧不必回查学生表；
- `quiet-hours.util.ts` 已把 `app` 与 email 同列为"非打扰渠道"，静默期可立即抵达（无需改动）。

## 3. 过程中发现并修复的两个真实缺陷

### 缺陷 A：worker 的 channel switch 缺 `app` 分支

`notification.worker.ts` 的 `sendNotification()` switch 只有
`wechat` / `sms` / `email`，`app` 落到 `default` →
`unsupported_channel:app`，任务全部失败。

**关键点**：worker 用的是**独立实现**（`workers/notification.worker.ts`，
批量 100 / 30s），与 API 侧 `NotificationDispatchService`
（批量 8 / 5s）是两套代码。只改后者不会影响 worker ——
这也是最初"改了却看不到 app 日志"的原因。

### 缺陷 B：无模板时兜底是 `JSON.stringify(params)` 🔴

两个派发入口原本都这么写：

```ts
const content = template?.content
  ? renderTemplate(template.content, params)
  : JSON.stringify(params || {});
```

平时无害，因为 email/sms/wechat 都随包发布了模板记录。
但模板表按 `(channel, template_code)` 唯一，随包的
`WARNING_NOTIFICATION` **只有 email/sms/wechat 三个版本，没有 app 版本**。
于是 app 渠道必然查不到模板、必然走兜底，学生收到的站内消息实测为：

```
{"email":"loadtest4217@loadtest.local","level":"yellow",
 "metric":"early_leave","window":"day","level_cn":"黄色预警",...}
```

两个问题：

1. 学生完全看不懂（这是给机器看的结构）；
2. **泄露内部字段** —— email、student_id、student_no、cooldown_key
   等本不该出现在学生视野里的数据被直接展示。

**修复**：

- 抽 `shared/notification-content.util.ts` 的
  `buildFallbackNotificationContent()`，两个入口共用，避免再次漂移；
- 兜底文案改为可读中文：`【黄色预警】<摘要>（日统计）请及时登录系统查看并处理。`；
- 模板查找增加**跨渠道退回**：app 查不到时退回 email 版本的同一 `template_code`。

## 4. 实测证据

### 4.1 表已复活且有真实数据

```
notification: 10029 行
  warning_yellow 10027
  warning_red        1
  class_notice       1
JSON 垃圾消息: 0
```

### 4.2 站内消息内容可读

```
系统检测到新的预警信息。
预警级别：黄色预警
预警内容：压测学生6676在《大学物理》课程中作业未交，触发日预警
请尽快登录系统查看详情。
```

### 4.3 接口全链路（学生账号实测）

```
[1] 学生登录: 201 code=0 token OK
[2] 未读数: 200 {"unread":2}
[3] 列表: 200 total=2 unread=2
     - [warning_red/红色预警] 【红色预警】月统计区间内缺勤 6 次… read=false
     - [class_notice/班级通知] 【班级通知】本周五班会调整为线上进行… read=false
[4] 标记已读: 201 {"id":"2123","unread":1}
[5] 越权标记他人消息: 404 "消息不存在或不属于当前用户"
[6] 非法 ID: 400 "消息 ID 必须是数字"
[7] 仅未读: 200 total=1
[8] 全部已读: 201 {"updated":1,"unread":0}
```

### 4.4 app 渠道派发（worker 实测）

```
worker: {"jobs_found":100,"success_count":100,"failed_count":0,...}
交叉核对: completed_jobs = 243, send_status='success' 日志 = 243  （一致）
```

历史 `unsupported_channel:app` / `channel_not_implemented` 记录均为修复前的旧数据。

## 5. 回归防线

| 文件 | 用例数 | 锁定内容 |
| --- | --- | --- |
| `shared/notification-center.service.spec.ts` | 22 | 类型映射、user_id 转 bigint、空值跳过、异常不外抛、分页上限、越权防护、**只删已读** |
| `shared/notification-content.util.spec.ts` | 7 | 兜底文案可读、**绝不泄露 email/student_id/cooldown**、级别优先中文 |

后端全量：**9 套件 / 163 用例全绿**。

## 6. 已知局限（诚实记录）

- **前端未接入**：`/student/inbox` 接口已可用，但 `MyNotifications.vue`
  仍只读班级公告（`/student/notifications`）。给界面加"个人消息 + 未读红点"
  属于前端改动，本轮未做 —— 接口侧已具备全部能力。
- **小程序未接入**：`miniprogram/` 同样未加站内信页面。
- **wechat / wecom 渠道仍未实现**（需要微信开放平台凭据，属外部依赖）。
- `notification` 表按设计不含 `warning_id` 外键，因此站内消息与预警的
  关联只能靠 content 文本；如需强关联需改表结构。
