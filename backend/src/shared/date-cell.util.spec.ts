import {
  excelSerialToDate,
  looksLikeExcelSerial,
  parseDateCell,
  formatDateTime,
  DateParseError,
} from './date-cell.util';

/**
 * P1-8 回归测试：表格日期解析
 *
 * 核心断言来自**仓库自带模板的真实脏数据**：
 * `导入模板_课次课表_示例.xlsx` 的 session_start 单元格存的是
 * 数值 46083.4166666667，必须解析为 2026-03-02 10:00:00。
 */
describe('date-cell.util（P1-8 表格日期解析）', () => {
  describe('Excel 序列号 → 日期（模板真实值）', () => {
    it('46083.4166666667 → 2026-03-02 10:00:00（模板第 3 行真实脏数据）', () => {
      const d = excelSerialToDate(46083.4166666667);
      expect(formatDateTime(d)).toBe('2026-03-02 10:00:00');
    });

    it('46082.3333333333 → 2026-03-01 08:00:00（模板第 2 行）', () => {
      const d = excelSerialToDate(46082.3333333333);
      expect(formatDateTime(d)).toBe('2026-03-01 08:00:00');
    });

    it('46082.4027777778 → 2026-03-01 09:40:00', () => {
      const d = excelSerialToDate(46082.4027777778);
      expect(formatDateTime(d)).toBe('2026-03-01 09:40:00');
    });

    it('序列号 1 → 1900-01-01', () => {
      expect(formatDateTime(excelSerialToDate(1))).toBe('1900-01-01 00:00:00');
    });

    it('序列号 59 → 1900-02-28（闰年 bug 之前）', () => {
      expect(formatDateTime(excelSerialToDate(59))).toBe('1900-02-28 00:00:00');
    });

    it('序列号 61 → 1900-03-01（跳过虚构的 1900-02-29）', () => {
      expect(formatDateTime(excelSerialToDate(61))).toBe('1900-03-01 00:00:00');
    });

    it('1904 日期系统：序列号 0 → 1904-01-01', () => {
      expect(formatDateTime(excelSerialToDate(0, { date1904: true }))).toBe(
        '1904-01-01 00:00:00',
      );
    });

    it('1900 与 1904 系统相差 1462 天（按日历日比较）', () => {
      // ⚠️ 不能直接比较毫秒差：1900 年前后本机时区存在历史 LMT 偏移
      // （Asia/Shanghai 在 1901 年前为 UTC+8:05:43），毫秒差会有几秒抖动。
      // 真正的不变量是「日历日相差 1462 天」。
      const a = excelSerialToDate(100);
      const b = excelSerialToDate(100, { date1904: true });
      const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
      const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
      expect(Math.round((dayB - dayA) / (24 * 3600 * 1000))).toBe(1462);
    });

    it('浮点抖动被抹平（不出现 xx:59:59）', () => {
      const d = excelSerialToDate(46083.4166666667);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
    });
  });

  describe('looksLikeExcelSerial 区间判定', () => {
    it.each([
      [1, true],
      [46083.4166666667, true],
      [73415, true],
      [0, false],
      [0.5, false],
      [-3, false],
      [15, true], // 15 也在区间内（1900-01-15），故必须靠列元数据区分
      [999999, false],
      [NaN, false],
    ])('%p → %s', (input, expected) => {
      expect(looksLikeExcelSerial(input as number)).toBe(expected);
    });
  });

  describe('字符串格式解析', () => {
    const cases: Array<[string, string]> = [
      ['2026-03-02 10:00:00', '2026-03-02 10:00:00'],
      ['2026-03-02 10:00', '2026-03-02 10:00:00'],
      ['2026/3/2 10:00', '2026-03-02 10:00:00'],
      ['2026/03/02 10:00:00', '2026-03-02 10:00:00'],
      ['2026-03-02T10:00:00', '2026-03-02 10:00:00'],
      ['2026年3月2日 10:00', '2026-03-02 10:00:00'],
    ];

    it.each(cases)('"%s" → %s', (input, expected) => {
      expect(formatDateTime(parseDateCell(input))).toBe(expected);
    });

    it('纯日期字符串按本地零点解析（朴素墙上时间语义）', () => {
      const d = parseDateCell('2026-03-02');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(2);
      expect(d.getHours()).toBe(0);
    });

    it('数字字符串按序列号解析', () => {
      expect(formatDateTime(parseDateCell('46083.4166666667'))).toBe(
        '2026-03-02 10:00:00',
      );
    });
  });

  describe('必须显式报错，绝不静默返回错误日期', () => {
    it('空值报错', () => {
      expect(() => parseDateCell(null)).toThrow(DateParseError);
      expect(() => parseDateCell('')).toThrow(DateParseError);
      expect(() => parseDateCell(undefined)).toThrow(DateParseError);
    });

    it('超出序列号区间的数字报错（而不是当成 1970）', () => {
      expect(() => parseDateCell(999999)).toThrow(DateParseError);
      expect(() => parseDateCell(-5)).toThrow(DateParseError);
    });

    it('无法识别的文本报错', () => {
      expect(() => parseDateCell('下周一下午')).toThrow(DateParseError);
    });

    it('不存在的日期报错（2026-02-30）', () => {
      expect(() => parseDateCell('2026-02-30')).toThrow(DateParseError);
    });

    it('Invalid Date 对象报错', () => {
      expect(() => parseDateCell(new Date('x'))).toThrow(DateParseError);
    });

    it('错误信息带行列定位', () => {
      try {
        parseDateCell('乱码', { row: 3, column: 'session_start' });
        fail('应当抛出');
      } catch (e: any) {
        expect(e.message).toContain('第 3 行');
        expect(e.message).toContain('session_start');
      }
    });
  });

  describe('Date 对象直接透传', () => {
    it('合法 Date 原样返回', () => {
      const src = new Date('2026-03-02T10:00:00Z');
      expect(parseDateCell(src).getTime()).toBe(src.getTime());
    });
  });
});
