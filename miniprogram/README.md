# 学业预警系统 · 微信小程序（仅限学生使用）

微信**原生小程序**（非 uni-app / Taro），专为**在校学生**打造，UI 视觉与 Web 端 `clay-theme.css`（Claymorphism 绿系软陶主题 `#f1f2fa` / `#fffdf7` / `#4f9e6f`）保持完全一致，所有接口与现有 NestJS 后端契约对齐。

## 一、快速开始

1. 用**微信开发者工具**导入本目录（`miniprogram/`）
2. `project.config.json` 中的 `appid` 目前为 `touristappid`（测试号），正式发布前请替换为真实小程序 AppID。
3. **本地联调**：
   - 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
   - `config.js` 默认根据运行时 `envVersion` 自动识别环境（开发版走 `http://localhost:3000`，体验版/正式版走 `https://www.xueyeyujing.asia`）。真机预览开发版时请改为电脑局域网 IP。

## 二、登录与安全校验（仅限学生身份）

小程序请求统一使用 `Authorization: Bearer <token>` 请求头，且所有 `POST/PUT/PATCH/DELETE` 请求自动附带 `Idempotency-Key` 幂等键。

- **账号密码登录**：`POST /student/login` `{ student_no, name, password, wx_code? }`，要求学号、姓名与密码校验通过（登录成功自动绑定当前微信 openid，后续支持微信一键登录）。
- **微信一键登录**：`POST /student/login` `{ wx_code }`。
- **忘记密码 / 找回**：`POST /auth/recovery/options` → `send-email-code` / `send-sms-code` → `verify_code` → `reset-password`。
- **邮箱与手机号核验绑定**：绑定/更换邮箱走 `/auth/send_code (bind_email)` + `/auth/verify_code` + `POST /student/bind-email`；更换已绑手机号走 `student_change_mobile` 邮箱校验票据 + `POST /student/bind-phone`。
- **邮箱校验修改密码**：`POST /auth/send_code (student_change_password)` → `/auth/verify_code` → `POST /student/change-password { ticket, new_password }`。

## 三、页面清单（24 页，严格学生端）

| # | 路径 | 说明 | 主要接口 |
|---|---|---|---|
| 1 | `pages/login/login` | 学生登录、微信一键登录与验证码找回密码 | `POST /student/login`、`/auth/recovery/*` |
| 2 | `pages/index/index` | 学生首页（未读站内信+公告、今日考勤作业课程、预警统计、7天趋势、8项服务入口） | `/student/today`、`/student/weekly`、`/student/warnings`、`/student/inbox/unread-count`、`/student/notifications` |
| 3 | `pages/warnings/warnings` | 我的预警（四格统计、课程/等级/状态筛选、确认收到、直接转申诉） | `GET /student/warnings`、`GET /student/courses`、`POST /student/warnings/:id/confirm` |
| 4 | `pages/warning-detail/warning-detail` | 预警详情（触发明细、规则解释快照、确认收到、发起申诉） | `GET /student/warnings?id=...`、`POST /student/warnings/:id/confirm` |
| 5 | `pages/leaves/leaves` | 我的请假列表（含发起入口与证明图片标记） | `GET /student/leave_requests` |
| 6 | `pages/leave-detail/leave-detail` | 请假详情（带鉴权多图证明下载与大图预览） | `GET /student/leave_requests`、`/files/:id/download` |
| 7 | `pages/leave-form/leave-form` | 发起请假（类型、审批老师选择、起止日期时间、多图上传） | `GET /student/teachers`、`POST /student/leave_requests`、`/files/images` |
| 8 | `pages/appeals/appeals` | 我的申诉列表 | `GET /student/appeals` |
| 9 | `pages/appeal-detail/appeal-detail` | 申诉详情（带鉴权多图凭证预览） | `GET /student/appeals`、`/files/:id/download` |
| 10 | `pages/appeal-form/appeal-form` | 发起申诉（支持从预警页预填 `warning_id`/课程/原因，多图上传） | `POST /student/appeals`、`/files/images` |
| 11 | `pages/notifications/notifications` | 双通道消息中心（个人站内消息 `/student/inbox` + 班级公告 `/student/notifications`） | `/student/inbox*`、`/student/notifications*` |
| 12 | `pages/notification-detail/notification-detail` | 消息/公告详情（区分站内信与班级公告） | 同上 |
| 13 | `pages/schedules/schedules` | 本班课表（支持学期切换、校历周次与星期分组筛选） | `GET /schedules/semester-config`、`GET /schedules/view?scope=class` |
| 14 | `pages/attendance/attendance` | 近 7 天考勤与作业记录 | `GET /student/weekly` |
| 15 | `pages/checkin/checkin` | 课堂滚动二维码扫码签到与口令兜底 | `POST /attendance/checkin` |
| 16 | `pages/grades/grades` | 我的课程成绩（学期筛选、通过/挂科/获修学分统计） | `GET /student/grades` |
| 17 | `pages/summaries/summaries` | 周 / 月 / 学期汇总（含学分、GPA、挂科门数） | `GET /student/summaries` |
| 18 | `pages/profile/profile` | 学生个人中心（证件照头像、微信绑定与全部学生功能入口） | `GET /student/profile`、`POST /student/bind-wechat` |
| 19 | `pages/profile-edit/profile-edit` | 资料维护（证件照、联系方式）、手机邮箱核验绑定、换班申请与佐证图预览 | `PUT /student/profile`、`POST /student/bind-email|bind-phone`、`GET/POST /student/class-change-requests` |
| 20 | `pages/preferences/preferences` | 通知渠道偏好与夜间免打扰（静默时段）设置 | `GET/PUT /student/preferences` |
| 21 | `pages/change-password/change-password` | 绑定邮箱验证码核验改密 | `POST /auth/send_code`、`/auth/verify_code`、`POST /student/change-password` |
| 22 | `pages/bind-class/bind-class` | 学院与班级二级联动绑定（同步更新登录 token） | `GET /student/available-classes`、`POST /student/bind-class` |
| 23 | `pages/teachers/teachers` | 本班班主任与各科授课老师 | `GET /student/teachers` |
| 24 | `pages/about/about` | 关于学生端 | — |

## 四、请求与响应约定

- **成功码是 `0`**（`{ code: 0, message: 'ok', data: ... }`），`401 / 403` 自动清理登录态并跳转登录页。
- **受保护图片下载预览**：后端 `/files/:id/download` 校验登录身份，小程序端通过 `utils/request.js` 的 `downloadAuthImage(fileId)` / `loadAuthImageUrls(fileIds)` 携带 `Authorization` 下载为本地临时文件路径渲染和预览。
