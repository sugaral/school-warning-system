/**
 * 静默时段（quiet hours）工具 —— P1-2 修复
 *
 * 背景（实测）：
 *  - 全仓库搜索 `quiet` / `静默` / `免打扰` **0 命中**，静默期功能完全不存在；
 *  - `seed.ts` 已把 `quiet_hours: {start:'22:00', end:'08:00'}` 写进
 *    `student_profiles.notify_prefs_json`，但**没有任何通知代码读取它**，
 *    属于"只存不用"的浪费字段；
 *  - 后果：深夜可能给学生发短信/推送，打扰休息；个人偏好形同虚设。
 *
 * 本模块只做纯时间判断，不依赖任何框架，便于单测覆盖跨天/边界场景。
 */

export interface QuietHoursRange {
  start: string; // 'HH:mm'
  end: string;   // 'HH:mm'
}

export interface QuietHoursDecision {
  /** 当前是否处于静默期 */
  quiet: boolean;
  /** 静默期结束时间（用于把发送推迟到静默结束） */
  resumeAt: Date | null;
  /** 命中的规则来源：'personal' | 'strategy' | 'default' | null */
  source: 'personal' | 'strategy' | 'default' | null;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 解析 'HH:mm' 为「当天第几分钟」；非法返回 null */
export function parseHhmm(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = HHMM.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 规范化静默时段配置；缺失或非法返回 null（视为不静默） */
export function normalizeQuietHours(raw: any): QuietHoursRange | null {
  if (!raw || typeof raw !== 'object') return null;
  const start = raw.start ?? raw.from;
  const end = raw.end ?? raw.to;
  if (parseHhmm(start) === null || parseHhmm(end) === null) {
    return null;
  }
  // start === end 视为"全天静默"是危险的误配置，按不静默处理
  if (String(start) === String(end)) return null;
  return { start: String(start).trim(), end: String(end).trim() };
}

/**
 * 判断给定时刻是否落在静默区间内。
 *
 * **关键：必须正确处理跨天区间**（如 22:00–08:00，这是最常见的高校作息配置）。
 * 判定逻辑：
 *  - 非跨天（start < end）：start <= now < end
 *  - 跨天（start > end）：now >= start 或 now < end
 *
 * @param now 待判断时刻
 * @param range 静默区间
 * @returns 静默中返回 resumeAt（该区间结束时刻，即次日/当日 end）
 */
export function isWithinQuietHours(
  now: Date,
  range: QuietHoursRange | null,
): { quiet: boolean; resumeAt: Date | null } {
  if (!range) return { quiet: false, resumeAt: null };

  const startMin = parseHhmm(range.start);
  const endMin = parseHhmm(range.end);
  if (startMin === null || endMin === null) return { quiet: false, resumeAt: null };

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const crossMidnight = startMin > endMin;

  let quiet: boolean;
  if (crossMidnight) {
    quiet = nowMin >= startMin || nowMin < endMin;
  } else {
    quiet = nowMin >= startMin && nowMin < endMin;
  }

  if (!quiet) return { quiet: false, resumeAt: null };

  // 计算静默结束时刻。
  // ⚠️ 必须用 setHours(h, m) 而不是 setMinutes(endMin)：
  // setMinutes 是「设置分钟字段」而非「设置当天第几分钟」，
  // 后者会把当前的小时数保留下来，导致 03:00 + 480 分钟变成 11:00。
  const endHour = Math.floor(endMin / 60);
  const endMinute = endMin % 60;

  const resumeAt = new Date(now.getTime());
  resumeAt.setSeconds(0, 0);
  resumeAt.setHours(endHour, endMinute, 0, 0);

  // 跨天且当前在 start 之后 → 结束时刻落在"明天"
  if (crossMidnight && nowMin >= startMin) {
    resumeAt.setDate(resumeAt.getDate() + 1);
  }
  // 兜底：若算出的结束时刻不晚于当前，顺延一天
  if (resumeAt.getTime() <= now.getTime()) {
    resumeAt.setDate(resumeAt.getDate() + 1);
  }

  return { quiet: true, resumeAt };
}

/**
 * 该等级是否允许**强制突破**静默期。
 *
 * 安全兜底：red / severe 属于必须立刻知晓的严重风险，
 * 不能被"免打扰"挡住（否则学生可能错过干预窗口）。
 * 这是一条**有意为之的例外**，在此显式声明，不做静默行为。
 */
export function canBreakThroughQuietHours(level: unknown): boolean {
  const normalized = String(level || '').trim().toLowerCase();
  return normalized === 'red' || normalized === 'severe';
}

/**
 * 综合判定：结合「个人偏好」与「规则通知策略」，得出最终静默决策。
 *
 * 优先级（对齐 §6.4 第 4 条）：
 *  1. 个人偏好 `notify_prefs_json.quiet_hours` **优先**（学生自己的选择最重要）；
 *  2. 个人未配置时回退到规则的 `notify_strategy_json.quiet_hours`；
 *  3. `red` / `severe` 强制突破（见 canBreakThroughQuietHours）；
 *  4. `notify_prefs_json.<channel> === false` 表示该渠道被个人关闭 → 由调用方处理。
 */
export function resolveQuietHoursDecision(options: {
  now: Date;
  level: unknown;
  personalPrefs?: any;
  strategy?: any;
}): QuietHoursDecision {
  const { now, level, personalPrefs, strategy } = options;

  // 严重等级强制突破静默期
  if (canBreakThroughQuietHours(level)) {
    return { quiet: false, resumeAt: null, source: null };
  }

  const personalRange = normalizeQuietHours(personalPrefs?.quiet_hours);
  if (personalRange) {
    const { quiet, resumeAt } = isWithinQuietHours(now, personalRange);
    return { quiet, resumeAt, source: 'personal' };
  }

  const strategyRange = normalizeQuietHours(
    strategy?.quiet_hours ?? strategy?.send_time_policy?.quiet_hours,
  );
  if (strategyRange) {
    const { quiet, resumeAt } = isWithinQuietHours(now, strategyRange);
    return { quiet, resumeAt, source: 'strategy' };
  }

  return { quiet: false, resumeAt: null, source: null };
}

/**
 * 个人是否允许某渠道。个人偏好显式 false 视为拒绝。
 * 未配置时返回 true（默认允许），保证不因缺配置而静默丢消息。
 */
export function isChannelAllowedByPrefs(personalPrefs: any, channel: string): boolean {
  if (!personalPrefs || typeof personalPrefs !== 'object') return true;
  const value = personalPrefs[String(channel || '').toLowerCase()];
  if (value === undefined || value === null) return true;
  return value !== false;
}

/**
 * 该渠道在静默期是否可以立即发送（不受静默限制）。
 * 短信属于强打扰渠道，静默期必须推迟；站内信/邮件不打扰，可立即发。
 */
export function channelMustRespectQuietHours(channel: string): boolean {
  const normalized = String(channel || '').toLowerCase();
  // sms / wechat 属于推送打扰类；email / app(站内信) 可静默抵达
  return normalized === 'sms' || normalized === 'wechat' || normalized === 'wecom';
}
