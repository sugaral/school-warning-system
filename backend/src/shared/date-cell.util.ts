/**
 * 表格日期单元格解析器（P1-8 核心）
 *
 * 背景：仓库自带的导入模板存在**脏数据陷阱**（实测确认）：
 *   `导入模板_课次课表_示例.xlsx` 的 `session_start` 列，
 *   第 3 行（含表头的第 2 数据行）单元格值不是日期字符串，
 *   而是 **Excel 1900 日期序列号 `46083.4166666667`**；
 *   而同名 CSV 模板同一行是正常字符串 `2026-03-02 10:00:00`。
 *
 *   换算：1899-12-30 + 46083.4166666667 天 = 2026-03-02 10:00:00
 *         （小数 0.4166666667 × 24h = 10h）
 *   已用 xlsx 读取该单元格验证：{"t":"n","v":46083.4166666667,"w":"2026-03-02 10:00"}
 *
 * 若不做序列号识别，直接 new Date(46083.41) 会得到 1970-01-01 附近的时间，
 * 造成"静默的错误数据"——比报错更危险。因此本模块对所有可疑输入显式报错。
 */

/**
 * Excel 1900 日期系统的纪元（序列号 1 = 1900-01-01） */
const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
/** Excel 1904 日期系统的纪元（Mac 版 Excel；序列号 0 = 1904-01-01） */
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1);

/**
 * 合法序列号区间，对应 1900-01-01 ~ 2100-12-31。
 * 落在此区间之外的纯数字不再当作日期解释，直接报错，
 * 避免把"15"（expire_minutes）这类普通数字误判成 1900-01-14。
 */
const SERIAL_MIN = 1;
const SERIAL_MAX = 73415; // 2100-12-31

export interface DateParseOptions {
  /** 是否使用 1904 日期系统（Mac Excel 导出的文件） */
  date1904?: boolean;
  /** 列名，仅用于错误信息 */
  column?: string;
  /** 行号，仅用于错误信息 */
  row?: number;
}

export class DateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateParseError';
  }
}

/**
 * 把 Excel 序列号转换为 Date。
 *
 * ⚠️ 时区语义（关键）：
 * Excel 序列号表达的是**朴素墙上时间**（naive wall-clock），本身不带时区。
 * Excel 里显示 "2026-03-02 10:00"，解析结果在**本机时区**读出来也必须是
 * 2026-03-02 10:00。因此这里用本地时间分量构造 Date，而**不能**用 UTC 构造
 * 后再按本地读取（那会被时区偏移 8 小时；实测 UTC 构造 + 本地格式化
 * 会把 10:00 显示成 18:00）。
 *
 * 另外，若用"纪元毫秒 + 天数"的 UTC 算法，序列号 1 在 Asia/Shanghai 会因
 * 1901 年前的历史 LMT 偏移（UTC+8:05:43）得到 08:05:43 这种荒谬时间。
 * 按日期分量构造可完全规避这两类问题。
 *
 * 处理三个真实存在的坑：
 * 1. **1900 闰年 bug**：Excel 认为 1900 年是闰年（存在虚构的 1900-02-29），
 *    故序列号 60 无效；序列号 < 60 时需要额外 +1 天补偿。
 * 2. **1900 vs 1904 日期系统**：Mac Excel 默认 1904 起算，整体差 1462 天。
 * 3. **小数部分**：表示当天时间比例（0.5 = 12:00）。
 */
export function excelSerialToDate(serial: number, options: DateParseOptions = {}): Date {
  if (!Number.isFinite(serial)) {
    throw new DateParseError(`无效的 Excel 序列号：${serial}`);
  }

  // 1904 系统不存在闰年 bug
  const adjusted = options.date1904 ? serial : serial < 60 ? serial + 1 : serial;
  const epoch = options.date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;

  // 先按"整天数"推进日期，避免小数部分参与日期运算造成跨日误差
  const wholeDays = Math.floor(adjusted);
  let fraction = adjusted - wholeDays;
  if (fraction < 0) fraction = 0;

  const base = new Date(epoch);
  const d = new Date(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate() + wholeDays,
    0,
    0,
    0,
    0,
  );

  // 时间部分：四舍五入到整秒，抹掉浮点抖动（否则会出现 09:59:59.999）
  const secondsOfDay = Math.round(fraction * 24 * 60 * 60);
  d.setSeconds(d.getSeconds() + secondsOfDay);

  return d;
}

/** 抹掉毫秒误差（浮点乘除会产生 09:59:59.999 这类抖动） */
function roundToSecond(d: Date): Date {
  const ms = d.getTime();
  const rounded = Math.round(ms / 1000) * 1000;
  return new Date(rounded);
}

/** 该数字是否落在合理的 Excel 日期序列号区间内 */
export function looksLikeExcelSerial(value: number): boolean {
  return Number.isFinite(value) && value >= SERIAL_MIN && value <= SERIAL_MAX;
}

/**
 * 解析日期单元格。支持的输入形态：
 *  - Date 对象（xlsx 在 cellDates:true 时返回）
 *  - Excel 序列号数字（如 46083.4166666667）
 *  - 字符串：'2026-03-02 10:00:00' / '2026/3/2 10:00' / '2026-03-02'
 *            / '2026-03-02T10:00:00' / '2026年3月2日 10:00'
 *  - 纯数字字符串（'46083.4166666667'）—— 同样按序列号处理
 *
 * @throws DateParseError 当无法可靠解析时（**绝不静默返回 1970 或 Invalid Date**）
 */
export function parseDateCell(
  value: unknown,
  options: DateParseOptions = {},
): Date {
  const where = buildLocation(options);

  if (value === null || value === undefined || value === '') {
    throw new DateParseError(`日期为空${where}`);
  }

  // 1) 已是 Date
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DateParseError(`日期无效${where}`);
    }
    return value;
  }

  // 2) 数字 → Excel 序列号
  if (typeof value === 'number') {
    if (!looksLikeExcelSerial(value)) {
      throw new DateParseError(
        `数值 ${value} 不在合法日期序列号区间(${SERIAL_MIN}~${SERIAL_MAX})${where}；` +
          `若该列本应是日期，请检查单元格格式`,
      );
    }
    return excelSerialToDate(value, options);
  }

  const text = String(value).trim();
  if (!text) {
    throw new DateParseError(`日期为空${where}`);
  }

  // 3) 纯数字字符串 → 同样按序列号处理（CSV 导出常出现）
  if (/^\d+(\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (!looksLikeExcelSerial(num)) {
      throw new DateParseError(`数值 ${text} 不在合法日期序列号区间${where}`);
    }
    return excelSerialToDate(num, options);
  }

  // 4) 常见中文字符串格式 → 归一化后交给 Date 解析
  const normalized = text
    .replace(/年|月/g, '-')
    .replace(/日/g, ' ')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // 仅日期（无时间）→ 本地零点，与 Excel 的朴素墙上时间语义一致
  const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const dt = new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    if (
      dt.getFullYear() !== Number(y) ||
      dt.getMonth() !== Number(m) - 1 ||
      dt.getDate() !== Number(d)
    ) {
      throw new DateParseError(`日期不存在：${text}${where}`);
    }
    return dt;
  }

  // 带时间的格式：按"本地墙上时间"解析（模板里写的是无时区的朴素时间）
  const withTime =
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (withTime) {
    const [, y, m, d, hh, mi, ss] = withTime;
    const dt = new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mi),
      Number(ss || 0),
      0,
    );
    if (Number.isNaN(dt.getTime())) {
      throw new DateParseError(`日期无效：${text}${where}`);
    }
    return dt;
  }

  // 5) 兜底：交给 Date 解析；仍失败则显式报错（绝不返回 Invalid Date）
  const fallback = new Date(normalized);
  if (Number.isNaN(fallback.getTime())) {
    throw new DateParseError(
      `无法识别的日期格式："${text}"${where}；` +
        `支持 2026-03-02 / 2026/3/2 / 2026-03-02 10:00:00`,
    );
  }
  return fallback;
}

function buildLocation(options: DateParseOptions): string {
  const parts: string[] = [];
  if (options.row !== undefined) parts.push(`第 ${options.row} 行`);
  if (options.column) parts.push(`列 ${options.column}`);
  return parts.length ? `（${parts.join('，')}）` : '';
}

/** 格式化为 'YYYY-MM-DD HH:mm:ss'，用于错误报告与回显 */
export function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
