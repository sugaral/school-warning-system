/**
 * 日期时间输入解析（带校验）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：
 *
 * `attendance.controller.ts` 的 `POST /attendance/sessions` 直接写
 *   const start = new Date(dto.start_time)
 * 完全没有校验。`new Date('not-a-date')` 产生 Invalid Date，
 * 其 getTime() 是 NaN；NaN 一路传到 Prisma：
 *
 *   Invalid `prisma.schedules.findMany()` invocation:
 *     session_start: { gte: Invalid Date, lt: Invalid Date }
 *
 * 结果是**未捕获到业务层的 500**，而且因为控制器自己的 catch 把异常
 * 转成了 `{code:500}` 的 **HTTP 201** 响应体，客户端按状态码判断
 * 会以为创建成功。
 *
 * 实测（修复前）：
 *   'not-a-date' / '' / '1789000000000'  →  code=500，HTTP 201
 *
 * ⚠️ 故意**不接受**纯数字时间戳与 `Date` 以外的宽松输入：
 * 考勤课次的开始时间决定签到窗口与迟到判定，口径必须明确。
 * 允许的形态（与前端 <el-date-picker> 及 ISO 习惯一致）：
 *   - '2026-09-12T10:00:00.000Z'   ISO 带时区
 *   - '2026-09-12T10:00:00+08:00'  ISO 带偏移
 *   - '2026-09-12T10:00:00'        ISO 无时区（按**服务器本地时区**解释，
 *                                  与 MySQL DATETIME 的既有行为一致）
 *   - '2026-09-12 10:00:00'        空格分隔（前端常见）
 *   - '2026-09-12'                 仅日期（当日 00:00）
 * ─────────────────────────────────────────────────────────────
 */

export type DateTimeParseResult =
  | { ok: true; date: Date }
  | { ok: false; reason: string };

/** 允许的格式白名单（正则先行，避免 `new Date` 的宽松解析带来歧义） */
const ACCEPTED_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // ISO 带时区：2026-09-12T10:00:00Z / +08:00
  {
    re: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/i,
    label: 'ISO 8601（含时区）',
  },
  // ISO 无时区：2026-09-12T10:00:00.000
  {
    re: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?$/,
    label: 'ISO 8601（本地时区）',
  },
  // 仅日期
  { re: /^\d{4}-\d{2}-\d{2}$/, label: 'YYYY-MM-DD' },
];

/**
 * 解析并校验日期时间字符串。
 *
 * @param value 原始输入（未知类型，来自请求体）
 * @param field 字段名，用于生成可读的错误信息
 */
export function parseDateTimeInput(value: unknown, field = 'start_time'): DateTimeParseResult {
  if (value === null || value === undefined) {
    return { ok: false, reason: `${field} 不能为空` };
  }

  // 只接受字符串：数字时间戳/Date 对象会带来时区口径歧义
  if (typeof value !== 'string') {
    return {
      ok: false,
      reason: `${field} 必须是字符串（如 2026-09-12T10:00:00+08:00），收到 ${typeof value}`,
    };
  }

  const text = value.trim();
  if (!text) {
    return { ok: false, reason: `${field} 不能为空` };
  }

  // 纯数字（时间戳）单独给出更明确的提示，而不是笼统的格式错误
  if (/^\d+$/.test(text)) {
    return {
      ok: false,
      reason: `${field} 不接受纯数字时间戳（收到 "${text}"），请使用 2026-09-12T10:00:00+08:00 这类格式`,
    };
  }

  const matched = ACCEPTED_PATTERNS.find((p) => p.re.test(text));
  if (!matched) {
    return {
      ok: false,
      reason: `${field} 格式不正确（收到 "${text}"），支持 ISO 8601，如 2026-09-12T10:00:00+08:00 或 2026-09-12 10:00:00`,
    };
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    // 形如 2026-13-45 能过正则但过不了 Date
    return {
      ok: false,
      reason: `${field} 不是有效日期（收到 "${text}"）`,
    };
  }

  return { ok: true, date };
}

/**
 * 业务合理性校验：课次开始时间不应离谱。
 *
 * 允许 1 年前 ~ 1 年后，足以覆盖补录与提前排课，
 * 同时挡掉 1970 / 9999 这类明显的脏输入（它们会让
 * 签到窗口、迟到判定全部失真）。
 */
export function isValidSessionStart(
  date: Date,
  now: Date = new Date(),
): { ok: boolean; reason?: string } {
  const min = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const max = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  if (date.getTime() < min.getTime()) {
    return { ok: false, reason: `课次开始时间过早（${date.toISOString()}），不应早于一年前` };
  }
  if (date.getTime() > max.getTime()) {
    return { ok: false, reason: `课次开始时间过晚（${date.toISOString()}），不应晚于一年后` };
  }
  return { ok: true };
}
