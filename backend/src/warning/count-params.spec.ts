import { WarningService } from './warning.service';

/**
 * buildCountParams 兜底逻辑（P1-11 第三批）
 *
 * 真实故障链：
 *   1. 单指标预警的 trigger_detail_json 由 buildTriggerDetail() 产出，
 *      只有 `violation_count`，**没有** `late_count` / `absent_count`；
 *   2. 随包发布的 ORANGE_WARNING 模板正文写着 `{late_count}`；
 *   3. renderTemplate 对未知占位符保留原样
 *      → 学生收到的通知里是字面量 `{late_count}`。
 *
 * 这里直接对私有方法做白盒测试，锁死"metric 能兜底出自己的计数键"。
 */
describe('WarningService.buildCountParams 分指标计数兜底（P1-11）', () => {
  const service = new WarningService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    // NotificationCenterService（站内消息，见 notification-center.service.ts）
    {} as any,
  );

  const call = (warning: any) => (service as any).buildCountParams(warning);

  it('metric=late 且 detail 只有 violation_count 时，late_count 兜底为同一数值', () => {
    const params = call({
      metric: 'late',
      trigger_detail_json: { violation_count: 3, violation_type: 'late' },
    });
    expect(params.late_count).toBe(3);
    expect(params.violation_count).toBe(3);
    // 不应顺带编造其它指标的计数
    expect(params.absent_count).toBeUndefined();
  });

  it('metric=absent 时兜底出 absent_count', () => {
    const params = call({
      metric: 'absent',
      trigger_detail_json: { violation_count: 5, violation_type: 'absent' },
    });
    expect(params.absent_count).toBe(5);
  });

  it('metric=early_leave 时兜底出 early_leave_count', () => {
    const params = call({
      metric: 'early_leave',
      trigger_detail_json: { violation_count: 2 },
    });
    expect(params.early_leave_count).toBe(2);
  });

  it('detail 已有真实分指标计数时，绝不覆盖', () => {
    const params = call({
      metric: 'late',
      trigger_detail_json: {
        violation_count: 5,
        total_count: 5,
        late_count: 2,
        absent_count: 3,
      },
    });
    // 聚合路径给的 2 才是真值，不能被 violation_count=5 覆盖
    expect(params.late_count).toBe(2);
    expect(params.absent_count).toBe(3);
  });

  it('total_count 可作 violation_count 的兜底来源', () => {
    const params = call({
      metric: 'late',
      trigger_detail_json: { total_count: 7 },
    });
    expect(params.violation_count).toBe(7);
    expect(params.late_count).toBe(7);
  });

  it('累计预警(metric 非分指标)不编造分指标计数', () => {
    const params = call({
      metric: 'cumulative',
      trigger_detail_json: { violation_count: 9, total_count: 9 },
    });
    expect(params.violation_count).toBe(9);
    expect(params.late_count).toBeUndefined();
    expect(params.absent_count).toBeUndefined();
  });

  it('detail 是 JSON 字符串时同样生效（数据库取回的真实形态）', () => {
    const params = call({
      metric: 'absent',
      trigger_detail_json: JSON.stringify({ violation_count: 4, violation_type: 'absent' }),
    });
    expect(params.absent_count).toBe(4);
  });

  it('detail 缺失/畸形时安全返回空对象，不抛异常', () => {
    expect(call({ metric: 'late', trigger_detail_json: null })).toEqual({});
    expect(call({ metric: 'late', trigger_detail_json: 'not-json' })).toEqual({});
    expect(call({ metric: 'late' })).toEqual({});
  });

  it('metric 缺失时回退到 detail.violation_type', () => {
    const params = call({
      trigger_detail_json: { violation_count: 6, violation_type: 'late' },
    });
    expect(params.late_count).toBe(6);
  });
});
