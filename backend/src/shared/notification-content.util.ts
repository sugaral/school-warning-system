/**
 * 通知正文兜底（无模板时）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要这个 util：
 *
 * 原工程在两个派发入口里都用 `JSON.stringify(params)` 作为"无模板"的兜底：
 *   - src/workers/notification.worker.ts          （独立 worker）
 *   - src/warning/notification-dispatch.service.ts（API 侧派发）
 *
 * 平时看不出问题，因为 email/sms/wechat 三个渠道都随包发布了
 * message_templates 记录。但 `app`（站内信）渠道**没有**配套模板 ——
 * 模板表按 (channel, template_code) 唯一，随包的 WARNING_NOTIFICATION
 * 只有 email / sms / wechat 三个版本。于是 app 渠道必然走兜底分支，
 * 学生收到的站内消息变成了：
 *
 *   {"email":"loadtest4217@loadtest.local","level":"yellow",
 *    "metric":"early_leave","window":"day","level_cn":"黄色预警",...}
 *
 * 两个问题：
 *   1. 学生看不懂（这是给机器看的结构）；
 *   2. **泄露内部字段** —— email、student_id、student_no、cooldown_key
 *      等本不该出现在学生视野里的数据被直接展示。
 *
 * 因此兜底改成拼一段中文，并在两个入口共用同一实现，避免再漂移。
 * ─────────────────────────────────────────────────────────────
 */

/** 从渲染参数里挑出人类可读的中文文案 */
export function buildFallbackNotificationContent(params: Record<string, any> = {}): string {
  const summary = String(params?.trigger_summary || params?.warning_reason || '').trim();

  // 级别：优先中文变体，最后才退到机器码（至少比英文码可读）
  const levelText = String(
    params?.warning_level_text ||
      params?.level_cn ||
      params?.warning_level_cn ||
      params?.warning_level ||
      params?.level ||
      '',
  ).trim();

  const windowText = String(
    params?.warning_window_text ||
      params?.window_cn ||
      params?.warning_window_cn ||
      params?.warning_window ||
      params?.window ||
      '',
  ).trim();

  if (summary) {
    const parts = [`【${levelText || '学业预警'}】${summary}`];
    if (windowText) {
      parts.push(`（${windowText}统计）`);
    }
    parts.push('请及时登录系统查看并处理。');
    return parts.join('');
  }

  // 连摘要都没有（例如系统测试任务）→ 通用提示，仍然不含任何内部字段
  return `【${levelText || '系统通知'}】您有一条新的系统通知，请登录系统查看详情。`;
}
