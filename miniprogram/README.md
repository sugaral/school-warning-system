# 学业预警系统 · 微信小程序

微信**原生小程序**（非 uni-app / Taro），与现有 NestJS 后端契约对齐。

## 一、快速开始

1. 用**微信开发者工具**导入本目录（`miniprogram/`）
2. `project.config.json` 中的 `appid` 目前为 `touristappid`（测试号）。
   正式联调请替换为你自己的小程序 AppID。
3. **本地联调必做**：
   - 详情 → 本地设置 → 勾选
     「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
   - 编辑 `config.js`，把 `CURRENT` 指向 `ENV.dev`，并按需修改 `baseUrl`：
     - 模拟器：`http://localhost:3000`
     - **真机预览**：`http://<电脑局域网IP>:3000`（手机与电脑需同一网段，
       并在 Windows 防火墙放行 3000 端口）
4. 后端 CORS（若用 web-view 场景需配置）：
   ```
   CORS_ALLOWED_ORIGINS=http://localhost:8080,http://<你的IP>:8080
   ```

## 二、登录时序

小程序**不臆造** `token` 头，与后端 `AuthGuard` 一致使用 `Authorization: Bearer <token>`。

```
[启动]
  wx.login() → code
      ↓
POST /student/login { wx_code }
      ├─ 该 openid 已绑定学生 → 直接返回 { token, student }   ← 一键登录
      └─ 未绑定 → 失败
                    ↓
           用户填写「学号 + 姓名」（可选密码）
                    ↓
POST /student/login { student_no, name, password?, wx_code }
      ├─ 姓名与学籍不一致 → code 401「姓名不匹配」
      ├─ 密码错误        → code 401 + 剩余尝试次数
      └─ 成功            → { token, student }，同时绑定 openid
                    ↓
      写入 Storage(token) → reLaunch 到 /pages/index/index
```

> 关键点：后端 `/student/login` 要求**学号与姓名双匹配**（见
> `students.controller.ts` 的 `findStudentProfileForLogin`），
> 这是防止冒用学号的设计，小程序侧未做任何绕过。

## 三、页面清单（24 页）

| # | 路径 | 说明 | 主要接口 |
|---|---|---|---|
| 1 | `pages/login/login` | 登录 / 绑定学号 | `POST /student/login` |
| 2 | `pages/index/index` | 首页仪表盘（今日考勤作业、7 天趋势、预警数、通知状态） | `/student/today`、`/student/weekly`、`/student/summaries`、`/student/warnings` |
| 3 | `pages/warnings/warnings` | 我的预警（等级/状态筛选 + 分页） | `GET /student/warnings` |
| 4 | `pages/warning-detail/warning-detail` | 预警详情（触发明细 + 规则快照）+ 确认收到 | `POST /student/warnings/:id/confirm` |
| 5 | `pages/leaves/leaves` | 请假列表 | `GET /student/leave_requests` |
| 6 | `pages/leave-detail/leave-detail` | 请假详情 | 同上 |
| 7 | `pages/leave-form/leave-form` | 提交请假（多图证明） | `POST /student/leave_requests` + `/files/images` |
| 8 | `pages/appeals/appeals` | 申诉列表 | `GET /student/appeals` |
| 9 | `pages/appeal-detail/appeal-detail` | 申诉详情 | 同上 |
| 10 | `pages/appeal-form/appeal-form` | 提交申诉（多图证据） | `POST /student/appeals` + `/files/images` |
| 11 | `pages/notifications/notifications` | 班级通知 | `GET /student/notifications` |
| 12 | `pages/notification-detail/notification-detail` | 通知详情（进入即回执已读） | `POST /student/notifications/:id/read` |
| 13 | `pages/schedules/schedules` | 本班课表 | `GET /student/courses` |
| 14 | `pages/attendance/attendance` | 我的考勤（近 7 天） | `GET /student/weekly` |
| 15 | `pages/checkin/checkin` | 扫码签到（含手动兜底 + 二维码多格式解析） | `POST /attendance/checkin` |
| 16 | `pages/grades/grades` | 我的成绩 | `GET /student/courses` |
| 17 | `pages/summaries/summaries` | 周/月/学期汇总（含学分、GPA、挂科数） | `GET /student/summaries` |
| 18 | `pages/profile/profile` | 个人中心 | `GET /student/profile` |
| 19 | `pages/profile-edit/profile-edit` | 编辑资料（含紧急联系人） | `PUT /student/profile` |
| 20 | `pages/preferences/preferences` | 通知偏好（渠道 + 免打扰时段 + 订阅授权） | `GET/PUT /student/preferences` |
| 21 | `pages/change-password/change-password` | 修改密码 | `POST /student/change-password` |
| 22 | `pages/bind-class/bind-class` | 绑定班级 | `GET /student/available-classes`、`POST /student/bind-class` |
| 23 | `pages/teachers/teachers` | 我的老师 | `GET /student/teachers` |
| 24 | `pages/about/about` | 关于 | — |

## 四、请求与响应约定

统一封装在 `utils/request.js`：

```json
{ "code": 0, "message": "ok", "data": {...}, "trace_id": "..." }
```

- **成功码是 `0`，不是 200**
- `code !== 0` 时统一 toast 提示；`401 / 4010` 自动清登录态并跳登录页
- HTTP 401/403 同样跳登录页

**序列化注意**：后端将 `bigint` 序列化为**字符串**、`Decimal` 为字符串、`Date` 为 ISO 字符串。
因此页面中**不要把 id 当 number 运算或比较**，一律用 `String(a) === String(b)`。

## 五、扫码签到

- 二维码滚动令牌由后端 `shared/qr-session.util.ts` 生成：
  `token = sha256(qr_token_hash + ':' + bucketIndex).slice(0,16)`
- 刷新间隔来自配置 `warning.qrRefreshMinutes`（默认 **15 分钟**）
- 小程序侧支持三种二维码载荷：JSON、URL 查询串、`id|token`
- 接口挂了**幂等**（`@Idempotent()`），重复提交不会产生重复考勤记录

## 六、订阅消息（**平台限制，必须知悉**）

微信「**一次性订阅消息**」的硬限制：**用户每授权一次，只能推送 1 条**。
这不是后端缺陷，无法通过代码绕过。

可落地的产品方案（本小程序已按此实现）：

1. **随用随授权**：在用户查看预警详情等"高意愿"时刻顺带调用
   `wx.requestSubscribeMessage`，而不是只在设置页请求一次
2. **模板 ID 配置化**：填入 `config.js` 的 `SUBSCRIBE_TEMPLATE_IDS`，
   未配置时设置页的授权按钮自动隐藏（避免无效操作）
3. **多通道兜底**：严重预警同时走短信/邮件/站内信，
   不依赖微信推送的到达率
4. 若需长期订阅，需申请**长期订阅消息**类目（对高校场景需资质审核）

## 七、上线前检查

- [ ] `config.js` 的 `CURRENT` 改为 `ENV.prod`，`baseUrl` 为 **HTTPS** 域名
- [ ] 微信公众平台 → 开发 → 开发设置 → **服务器域名** 添加后端域名为 request 合法域名
- [ ] `project.config.json` 填入正式 `appid`
- [ ] `sitemap.json` 当前为 `disallow *`（后台系统不建议被搜索索引），按需调整
- [ ] `SUBSCRIBE_TEMPLATE_IDS` 填入已申请的模板 ID
