# 模板占位符一致性审计（P1-11）

> 生成脚本：`scripts/audit-template-vars.js`（只读审计，不修改文件）

> 生成时间：2026-09-12T06:20:22.887Z

## 汇总

| 指标 | 数值 |
| --- | --- |
| §8.3 任务书规定清单 | 32 |
| 运行时实际可渲染集合（清单+实现补充） | 35 |
| 数据库模板中实际使用 | 9 |
| seed.ts 中出现 | 1 |
| src 代码中出现（含 fallback） | 12 |
| **三处合计使用** | **13** |
| 🔴 使用但运行时不可渲染（硬缺陷） | 0 |
| 🟡 可渲染但 §8.3 未登记（规格漂移） | 3 |
| §8.3 登记但无任何模板使用 | 22 |

## ✅ 无"运行时不可渲染"的占位符

> 三处（数据库模板 / seed.ts / src fallback）使用的全部变量，
> 都能在渲染参数里找到对应键。

## 🟡 可渲染但 §8.3 任务书清单未登记（规格漂移）

> 实现侧已提供这些变量（见本脚本 `RUNTIME_EXTRA_VARS`），
> 但任务书 §8.3 的内置清单没有它们。属于**需求侧漏写**，
> 不是代码缺陷；记录在此以免下次审计误判为回归。

| 变量 | 数据库模板 | seed | src（前几处） |
| --- | --- | --- | --- |
| `{late_count}` | ORANGE_WARNING(wechat) | Y | — |
| `{warning_level_text}` | WARNING_NOTIFICATION(email), ABSENT_THRESHOLD_EMAIL(email) | — | backend/src/config/config.controller.ts<br>backend/src/config/message-templates.contract.spec.ts |
| `{warning_window_text}` | ABSENT_THRESHOLD_EMAIL(email) | — | backend/src/config/config.controller.ts<br>backend/src/warning/warning.service.ts |

## §8.3 已登记但当前无模板使用

| 变量 | 说明 |
| --- | --- |
| `{class_name}` | 清单内、暂无模板引用 |
| `{code}` | 清单内、暂无模板引用 |
| `{date}` | 清单内、暂无模板引用 |
| `{email}` | 清单内、暂无模板引用 |
| `{head_teacher_name}` | 清单内、暂无模板引用 |
| `{level}` | 清单内、暂无模板引用 |
| `{metric}` | 清单内、暂无模板引用 |
| `{metric_cn}` | 清单内、暂无模板引用 |
| `{org_name}` | 清单内、暂无模板引用 |
| `{period_end}` | 清单内、暂无模板引用 |
| `{period_start}` | 清单内、暂无模板引用 |
| `{school_name}` | 清单内、暂无模板引用 |
| `{student_email}` | 清单内、暂无模板引用 |
| `{time}` | 清单内、暂无模板引用 |
| `{timestamp}` | 清单内、暂无模板引用 |
| `{violation_count}` | 清单内、暂无模板引用 |
| `{violation_type}` | 清单内、暂无模板引用 |
| `{violation_type_cn}` | 清单内、暂无模板引用 |
| `{warning_level_cn}` | 清单内、暂无模板引用 |
| `{warning_window_cn}` | 清单内、暂无模板引用 |
| `{window}` | 清单内、暂无模板引用 |
| `{window_cn}` | 清单内、暂无模板引用 |

> 这不算缺陷：清单是"能力声明"，允许模板按需引用。但若长期无人用，
> 需确认调用方是否真的传了对应参数，否则模板作者一用就会渲染成原样占位符。

## 数据库模板逐条占位符

| 模板 | 渠道 | 占位符 |
| --- | --- | --- |
| YELLOW_WARNING | wechat | — |
| ORANGE_WARNING | wechat | {late_count} |
| RED_WARNING | wechat | — |
| SEVERE_WARNING | wechat | — |
| AUTH_VERIFY_CODE | email | {expire_minutes} |
| PASSWORD_RESET_EMAIL_CODE | email | {expire_minutes} |
| AUTH_BIND_EMAIL_CODE | email | {expire_minutes} |
| WARNING_NOTIFICATION | email | {warning_level_text} {warning_reason} |
| ADMIN_LOGIN_VERIFY_CODE | email | {expire_minutes} |
| PASSWORD_RESET_SMS_CODE | sms | {system_name} {expire_minutes} |
| SYSTEM_TEST_SMS | sms | {system_name} |
| WARNING_NOTIFICATION | wechat | {warning_reason} |
| SYSTEM_TEST_EMAIL | email | {system_name} |
| ABSENT_THRESHOLD_EMAIL | email | {student_name} {warning_window_text} {absent_count} {warning_level_text} {trigger_summary} |
| WARNING_NOTIFICATION | sms | {system_name} {warning_reason} |
| AUTH_VERIFY_CODE | sms | {system_name} {expire_minutes} |