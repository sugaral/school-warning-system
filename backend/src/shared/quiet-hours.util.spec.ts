import {
  parseHhmm,
  normalizeQuietHours,
  isWithinQuietHours,
  canBreakThroughQuietHours,
  resolveQuietHoursDecision,
  isChannelAllowedByPrefs,
  channelMustRespectQuietHours,
} from './quiet-hours.util';

/** 构造本地时间（与实现使用的 getHours 口径一致） */
function at(hh: number, mm: number, day = 15): Date {
  return new Date(2026, 8, day, hh, mm, 0, 0);
}

describe('quiet-hours（P1-2 静默时段）', () => {
  describe('parseHhmm', () => {
    it.each([
      ['00:00', 0],
      ['08:00', 480],
      ['22:00', 1320],
      ['23:59', 1439],
      ['9:05', 545],
    ])('解析 %s → %i 分钟', (input, expected) => {
      expect(parseHhmm(input)).toBe(expected);
    });

    it.each([['24:00'], ['12:60'], ['abc'], [''], [null], [undefined], [22]])(
      '非法输入 %p → null',
      (input) => {
        expect(parseHhmm(input as any)).toBeNull();
      },
    );
  });

  describe('normalizeQuietHours', () => {
    it('接受 start/end', () => {
      expect(normalizeQuietHours({ start: '22:00', end: '08:00' })).toEqual({
        start: '22:00',
        end: '08:00',
      });
    });

    it('兼容 from/to 别名', () => {
      expect(normalizeQuietHours({ from: '23:00', to: '07:00' })).toEqual({
        start: '23:00',
        end: '07:00',
      });
    });

    it('start === end 视为误配置 → null（避免全天静默）', () => {
      expect(normalizeQuietHours({ start: '08:00', end: '08:00' })).toBeNull();
    });

    it('缺失或非法 → null', () => {
      expect(normalizeQuietHours(null)).toBeNull();
      expect(normalizeQuietHours({})).toBeNull();
      expect(normalizeQuietHours({ start: 'xx', end: '08:00' })).toBeNull();
    });
  });

  describe('isWithinQuietHours —— 跨天区间（22:00-08:00）', () => {
    const range = { start: '22:00', end: '08:00' };

    it.each([
      [22, 0, true],
      [23, 30, true],
      [0, 0, true],
      [3, 15, true],
      [7, 59, true],
      [8, 0, false],
      [12, 0, false],
      [21, 59, false],
    ])('%i:%i → quiet=%s', (hh, mm, expected) => {
      expect(isWithinQuietHours(at(hh, mm), range).quiet).toBe(expected);
    });

    it('22:00 进入静默时，结束时刻应落在次日 08:00', () => {
      const { quiet, resumeAt } = isWithinQuietHours(at(22, 30), range);
      expect(quiet).toBe(true);
      expect(resumeAt).not.toBeNull();
      expect(resumeAt!.getDate()).toBe(16); // 次日
      expect(resumeAt!.getHours()).toBe(8);
      expect(resumeAt!.getMinutes()).toBe(0);
    });

    it('凌晨 03:00 时，结束时刻应落在当日 08:00', () => {
      const { quiet, resumeAt } = isWithinQuietHours(at(3, 0), range);
      expect(quiet).toBe(true);
      expect(resumeAt!.getDate()).toBe(15); // 当日
      expect(resumeAt!.getHours()).toBe(8);
    });
  });

  describe('isWithinQuietHours —— 非跨天区间（12:00-14:00）', () => {
    const range = { start: '12:00', end: '14:00' };

    it.each([
      [11, 59, false],
      [12, 0, true],
      [13, 30, true],
      [14, 0, false],
      [23, 0, false],
    ])('%i:%i → quiet=%s', (hh, mm, expected) => {
      expect(isWithinQuietHours(at(hh, mm), range).quiet).toBe(expected);
    });
  });

  describe('安全兜底：red / severe 强制突破', () => {
    it.each([['red'], ['severe'], ['RED'], [' severe ']])(
      '%s 允许突破静默',
      (level) => {
        expect(canBreakThroughQuietHours(level)).toBe(true);
      },
    );

    it.each([['yellow'], ['orange'], [''], [null], [undefined]])(
      '%p 不允许突破',
      (level) => {
        expect(canBreakThroughQuietHours(level)).toBe(false);
      },
    );

    it('red 等级在静默时段内仍判定为不静默', () => {
      const d = resolveQuietHoursDecision({
        now: at(23, 0),
        level: 'red',
        personalPrefs: { quiet_hours: { start: '22:00', end: '08:00' } },
      });
      expect(d.quiet).toBe(false);
      expect(d.resumeAt).toBeNull();
    });
  });

  describe('resolveQuietHoursDecision 优先级', () => {
    it('个人偏好优先于规则策略', () => {
      const d = resolveQuietHoursDecision({
        now: at(23, 0),
        level: 'yellow',
        personalPrefs: { quiet_hours: { start: '22:00', end: '08:00' } },
        strategy: { quiet_hours: { start: '01:00', end: '02:00' } },
      });
      expect(d.source).toBe('personal');
      expect(d.quiet).toBe(true);
    });

    it('个人未配置时回退规则策略', () => {
      const d = resolveQuietHoursDecision({
        now: at(1, 30),
        level: 'yellow',
        personalPrefs: {},
        strategy: { quiet_hours: { start: '01:00', end: '02:00' } },
      });
      expect(d.source).toBe('strategy');
      expect(d.quiet).toBe(true);
    });

    it('两者都未配置时视为不静默', () => {
      const d = resolveQuietHoursDecision({ now: at(23, 0), level: 'yellow' });
      expect(d.quiet).toBe(false);
      expect(d.source).toBeNull();
    });
  });

  describe('渠道与个人偏好', () => {
    it.each([
      ['sms', true],
      ['wechat', true],
      ['wecom', true],
      ['email', false],
      ['app', false],
    ])('%s 是否需要遵守静默期 → %s', (channel, expected) => {
      expect(channelMustRespectQuietHours(channel)).toBe(expected);
    });

    it('个人显式关闭渠道 → 不允许', () => {
      expect(isChannelAllowedByPrefs({ sms: false }, 'sms')).toBe(false);
    });

    it('个人未配置渠道 → 默认允许（不因缺配置而丢消息）', () => {
      expect(isChannelAllowedByPrefs({ email: false }, 'sms')).toBe(true);
      expect(isChannelAllowedByPrefs({}, 'wechat')).toBe(true);
      expect(isChannelAllowedByPrefs(null, 'wechat')).toBe(true);
    });
  });
});
