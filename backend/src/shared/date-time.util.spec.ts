import { parseDateTimeInput, isValidSessionStart } from './date-time.util';

/**
 * 日期时间输入校验
 *
 * 真实故障（本轮复现）：POST /attendance/sessions 对 start_time
 * 完全不校验，'not-a-date' / '' / '1789000000000' 都会经
 * `new Date()` 变成 Invalid Date，NaN 传进 Prisma 后抛
 * "Invalid `prisma.schedules.findMany()` invocation"，
 * 而控制器 catch 把它转成 {code:500} 的 **HTTP 201** —— 客户端按
 * 状态码判断会以为创建成功。
 */
describe('parseDateTimeInput', () => {
  it('接受 ISO 带时区（Z）', () => {
    const r = parseDateTimeInput('2026-09-12T10:00:00.000Z');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.date.toISOString()).toBe('2026-09-12T10:00:00.000Z');
  });

  it('接受 ISO 带偏移', () => {
    const r = parseDateTimeInput('2026-09-12T10:00:00+08:00');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.date.toISOString()).toBe('2026-09-12T02:00:00.000Z');
  });

  it('接受 ISO 无时区（按本地时区解释）', () => {
    const r = parseDateTimeInput('2026-09-12T10:00:00');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 本地时区解释：小时数应与输入一致
      expect(r.date.getHours()).toBe(10);
      expect(r.date.getMinutes()).toBe(0);
    }
  });

  it('接受空格分隔（前端 el-date-picker 常见输出）', () => {
    const r = parseDateTimeInput('2026-09-12 10:00:00');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.date.getHours()).toBe(10);
  });

  it('接受仅日期', () => {
    const r = parseDateTimeInput('2026-09-12');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.date.getFullYear()).toBe(2026);
      expect(r.date.getMonth()).toBe(8); // 0-based
      expect(r.date.getDate()).toBe(12);
    }
  });

  it('拒绝非法字符串（修复前会变成 Invalid Date → Prisma 500）', () => {
    const r = parseDateTimeInput('not-a-date');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('格式不正确');
  });

  it('拒绝空字符串', () => {
    const r = parseDateTimeInput('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不能为空');
  });

  it('拒绝纯空白', () => {
    const r = parseDateTimeInput('   ');
    expect(r.ok).toBe(false);
  });

  it('拒绝 null / undefined', () => {
    expect(parseDateTimeInput(null).ok).toBe(false);
    expect(parseDateTimeInput(undefined).ok).toBe(false);
  });

  it('拒绝数字时间戳并给出针对性提示（而不是笼统格式错误）', () => {
    const r = parseDateTimeInput('1789000000000');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不接受纯数字时间戳');
  });

  it('拒绝非字符串类型', () => {
    expect(parseDateTimeInput(123 as any).ok).toBe(false);
    expect(parseDateTimeInput({} as any).ok).toBe(false);
    if (!parseDateTimeInput(123 as any).ok) {
      expect((parseDateTimeInput(123 as any) as any).reason).toContain('必须是字符串');
    }
  });

  it('拒绝正则能过但 Date 无效的日期（如 2026-13-45）', () => {
    const r = parseDateTimeInput('2026-13-45');
    expect(r.ok).toBe(false);
  });

  it('错误信息里带字段名，便于前端定位', () => {
    const r = parseDateTimeInput('bad', 'end_time');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('end_time');
  });
});

describe('isValidSessionStart', () => {
  const now = new Date('2026-09-12T10:00:00Z');

  it('接受当前时间附近', () => {
    expect(isValidSessionStart(new Date('2026-09-12T09:00:00Z'), now).ok).toBe(true);
  });

  it('拒绝一年前（如 1970 这类脏输入）', () => {
    const r = isValidSessionStart(new Date('1970-01-01T00:00:00Z'), now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('过早');
  });

  it('拒绝一年后（如 9999 这类脏输入）', () => {
    const r = isValidSessionStart(new Date('9999-12-31T00:00:00Z'), now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('过晚');
  });

  it('允许补录：半年前的历史课次', () => {
    expect(isValidSessionStart(new Date('2026-03-01T10:00:00Z'), now).ok).toBe(true);
  });
});
