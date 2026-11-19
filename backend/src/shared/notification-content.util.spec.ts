import { buildFallbackNotificationContent } from './notification-content.util';

/**
 * 无模板时的兜底文案
 *
 * 这条路径**真的会进入学生视野**：`app`（站内信）渠道没有配套模板，
 * 必然走兜底。修复前兜底是 JSON.stringify(params)，实测学生收到：
 *   {"email":"loadtest4217@loadtest.local","level":"yellow",...}
 */
describe('buildFallbackNotificationContent', () => {
  it('用 trigger_summary 拼出可读中文', () => {
    const text = buildFallbackNotificationContent({
      trigger_summary: '压测学生4173在《计算机组成原理》课程中早退，触发日预警',
      warning_level_text: '黄色预警',
      warning_window_text: '日',
    });
    expect(text).toContain('压测学生4173');
    expect(text).toContain('黄色预警');
    expect(text).toContain('日统计');
    expect(text).toContain('请及时登录系统查看并处理');
  });

  it('绝不泄露内部字段（email / student_id / cooldown_key 等）', () => {
    const text = buildFallbackNotificationContent({
      email: 'student@loadtest.local',
      student_email: 'student@loadtest.local',
      student_id: '16182',
      student_no: 'LT100570',
      cooldown_key: '16182:yellow:3:2026-09-07:app',
      metric: 'early_leave',
      trigger_summary: '早退预警',
      warning_level_text: '黄色预警',
    });

    // 这是本轮修复的核心断言
    expect(text).not.toContain('@');
    expect(text).not.toContain('loadtest');
    expect(text).not.toContain('16182');
    expect(text).not.toContain('LT100570');
    expect(text).not.toContain('cooldown');
    expect(text).not.toContain('{');
    expect(text).not.toContain('"');
    // 且必须是可读中文
    expect(text).toContain('早退预警');
  });

  it('warning_reason 可作为 trigger_summary 的替代', () => {
    const text = buildFallbackNotificationContent({
      warning_reason: '本月缺勤 6 次',
      level_cn: '红色预警',
      window_cn: '月',
    });
    expect(text).toContain('本月缺勤 6 次');
    expect(text).toContain('红色预警');
  });

  it('完全没有摘要时给通用提示，不抛异常', () => {
    const text = buildFallbackNotificationContent({});
    expect(text).toContain('系统通知');
    expect(text).not.toContain('{');
  });

  it('params 为 undefined 也不崩', () => {
    expect(() => buildFallbackNotificationContent(undefined as any)).not.toThrow();
  });

  it('级别优先中文变体，而不是机器码', () => {
    const text = buildFallbackNotificationContent({
      trigger_summary: '缺勤预警',
      warning_level: 'red',
      warning_level_text: '红色预警',
    });
    expect(text).toContain('红色预警');
    expect(text).not.toContain('red');
  });

  it('没有中文级别时才退到机器码（至少非空）', () => {
    const text = buildFallbackNotificationContent({
      trigger_summary: '缺勤预警',
      level: 'orange',
    });
    expect(text).toContain('orange');
    expect(text).toContain('缺勤预警');
  });
});
