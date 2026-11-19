import { DEFAULT_MESSAGE_TEMPLATES } from './config.controller';
import { renderTemplate } from '../shared/template.util';

/**
 * 模板 ↔ 渲染参数契约测试（P1-11 回归防线）
 *
 * 背景（真实故障）：
 *   随包发布的模板里写了 `{late_count}`、`{absent_count}`、`{warning_window}`、
 *   而 warning.service.ts 的 params_json **没有提供**这些键。
 *   由于 renderTemplate 对未知占位符采取「保留原样」策略，
 *   学生收到的通知里出现了字面量 `{absent_count}`、`当前week缺课`。
 *
 * 这个 spec 把「模板用到的变量」与「渲染参数提供的键」钉死在一起：
 * 任何一侧改动导致不匹配，这里立刻红。
 */

/** warning.service.ts createNotificationJob 实际产出的键（含 P1-11 新增） */
const WARNING_PARAMS = [
  // 学生/系统
  'student_name', 'student_no', 'student_email', 'email', 'system_name',
  // 指标
  'violation_type', 'violation_type_text', 'metric', 'metric_cn',
  // 级别：机器码 + 中文文本变体
  'level', 'warning_level', 'level_cn', 'warning_level_text', 'warning_level_cn',
  // 窗口：机器码 + 中文文本变体
  'window', 'warning_window', 'window_cn', 'warning_window_text', 'warning_window_cn',
  // 说明
  'warning_reason', 'trigger_summary',
  // 计数（来自 trigger_detail_json，P1-11 新增）
  'late_count', 'absent_count', 'violation_count',
  // 周期
  'period_start', 'period_end',
];

/** 认证链路（邮件）的渲染参数 —— 见 auth.controller.ts loadVerifyEmailContent */
const AUTH_EMAIL_PARAMS = [
  'code', 'email', 'target', 'purpose',
  'expire_seconds', 'expireSeconds', 'expire_minutes', 'expireMinutes',
];

/**
 * 认证链路（短信）的渲染参数 —— 见 auth.controller.ts loadVerifySmsContent
 * 短信模板用【{system_name}】做签名，所以比邮件多一个 system_name。
 */
const AUTH_SMS_PARAMS = [...AUTH_EMAIL_PARAMS, 'system_name', 'mobile'];

/** 系统测试邮件参数 */
const TEST_MAIL_PARAMS = ['system_name', 'timestamp', 'email'];

function extractVars(text: string): string[] {
  const out = new Set<string>();
  // 与 template.util 同构：{key} 与 \{key\} 都算占位符
  const re = /\\?\{([^{}]+?)\\?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.add(m[1].trim());
  }
  return [...out];
}

const allTemplates = DEFAULT_MESSAGE_TEMPLATES.map((t: any) => ({
  channel: t.channel as string,
  code: t.template_code as string,
  title: (t.title || '') as string,
  content: t.content as string,
  legacyContents: ((t as any).legacyContents || []) as string[],
}));

function paramsFor(t: { code: string; channel: string }): string[] {
  if (t.code === 'ABSENT_THRESHOLD_EMAIL') {
    return [...WARNING_PARAMS, 'absent_threshold', 'warning_id'];
  }
  if (t.code === 'WARNING_NOTIFICATION') {
    return WARNING_PARAMS;
  }
  if (t.code === 'SYSTEM_TEST_EMAIL' || t.code === 'SYSTEM_TEST_SMS') {
    return TEST_MAIL_PARAMS;
  }
  // 其余都是认证类模板：短信比邮件多一个 system_name 签名变量
  return t.channel === 'sms' ? AUTH_SMS_PARAMS : AUTH_EMAIL_PARAMS;
}

describe('消息模板 ↔ 渲染参数契约（P1-11）', () => {
  it('所有默认模板的占位符都能被对应渲染参数覆盖', () => {
    const problems: string[] = [];

    for (const t of allTemplates) {
      const provided = new Set(paramsFor(t));
      const used = [...extractVars(t.title), ...extractVars(t.content)];
      for (const v of used) {
        if (!provided.has(v)) {
          problems.push(`${t.channel}/${t.code} 用到 {${v}} 但渲染参数未提供`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('模板不应包含 {code} 之外的认证变量混入预警模板', () => {
    const warningTemplates = allTemplates.filter(
      (t) => t.code === 'WARNING_NOTIFICATION' || t.code === 'ABSENT_THRESHOLD_EMAIL',
    );
    for (const t of warningTemplates) {
      const used = [...extractVars(t.title), ...extractVars(t.content)];
      expect(used).not.toContain('code');
      expect(used).not.toContain('expire_minutes');
    }
  });

  it('ABSENT_THRESHOLD_EMAIL 使用 *_text 变体，不得直接用机器码变量', () => {
    const t = allTemplates.find((x) => x.code === 'ABSENT_THRESHOLD_EMAIL');
    expect(t).toBeDefined();
    const used = extractVars(t!.content);

    // 必须用中文文本变体
    expect(used).toContain('warning_window_text');
    expect(used).toContain('warning_level_text');
    // 不得再用裸变量（否则渲染出 week / orange）
    expect(used).not.toContain('warning_window');
    expect(used).not.toContain('warning_level');
  });

  it('ABSENT_THRESHOLD_EMAIL 登记了旧正文，保证已部署环境会被懒升级覆盖', () => {
    const t = allTemplates.find((x) => x.code === 'ABSENT_THRESHOLD_EMAIL');
    expect(t!.legacyContents.length).toBeGreaterThan(0);
    // 旧正文里确实用了裸变量，这正是要被替换掉的那一版
    const legacyVars = extractVars(t!.legacyContents[0]);
    expect(legacyVars).toContain('warning_window');
    expect(legacyVars).toContain('warning_level');
  });

  it('WARNING_NOTIFICATION(email) 也必须用 {warning_level_text}，不得用机器码变量', () => {
    // 实测故障：投递到本地 SMTP 收信服务后解出的报文显示
    //   「预警级别：yellow」—— 数据库模板用的是裸 {warning_level}。
    // 这条测试防止它再被改回去。
    const t = allTemplates.find(
      (x) => x.code === 'WARNING_NOTIFICATION' && x.channel === 'email',
    );
    expect(t).toBeDefined();
    const used = extractVars(t!.content);
    expect(used).toContain('warning_level_text');
    expect(used).not.toContain('warning_level');

    // 并且要登记旧正文，否则已部署环境不会被懒升级覆盖
    expect(t!.legacyContents.length).toBeGreaterThan(0);
    expect(extractVars(t!.legacyContents[0])).toContain('warning_level');
  });

  it('用真实参数渲染 WARNING_NOTIFICATION(email)，正文必须是中文且无残留占位符', () => {
    const t = allTemplates.find(
      (x) => x.code === 'WARNING_NOTIFICATION' && x.channel === 'email',
    )!;
    const params: Record<string, any> = {
      system_name: '学业预警系统',
      warning_level: 'yellow',
      warning_level_text: '黄色预警',
      warning_level_cn: '黄色预警',
      warning_reason: '压测学生4584本月未确认预警 10 条，触发月预警',
      trigger_summary: '压测学生4584本月未确认预警 10 条，触发月预警',
    };
    const body = renderTemplate(t.content, params);
    expect(body).not.toMatch(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/);
    expect(body).toContain('黄色预警');
    // 机器码不得出现在正文里
    expect(body).not.toContain('yellow');
    expect(body).not.toContain('\\n');
  });

  it('用真实参数渲染 ABSENT_THRESHOLD_EMAIL，正文必须是中文且无残留占位符', () => {
    const t = allTemplates.find((x) => x.code === 'ABSENT_THRESHOLD_EMAIL')!;

    const params: Record<string, any> = {
      system_name: '学业预警系统',
      student_name: '张三',
      student_no: '20230003',
      student_email: 'z@test.local',
      email: 'z@test.local',
      violation_type: 'absent',
      violation_type_text: '缺课',
      metric: 'absent',
      metric_cn: '缺课',
      level: 'orange',
      // 契约：warning_level 保存机器码 —— notification-dispatch.service.ts:378
      // 用它判定 red/severe 是否突破静默期，绝不能是中文
      warning_level: 'orange',
      level_cn: '橙色预警',
      warning_level_text: '橙色预警',
      warning_level_cn: '橙色预警',
      window: 'week',
      warning_window: 'week',
      window_cn: '周',
      warning_window_text: '周',
      warning_window_cn: '周',
      warning_reason: '本周缺课 2 次',
      trigger_summary: '本周缺课 2 次',
      late_count: 0,
      absent_count: 2,
      violation_count: 2,
      period_start: '2026-09-07',
      period_end: '2026-09-13',
      absent_threshold: 3,
      warning_id: '12345',
    };

    const subject = renderTemplate(t.title, params);
    const body = renderTemplate(t.content, params);

    // 1) 无残留占位符
    expect(body).not.toMatch(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/);
    expect(subject).not.toMatch(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/);

    // 2) 不得出现英文字面量 week / orange（P1-11 的真实故障表现）
    expect(body).not.toContain('week');
    expect(body).not.toContain('orange');

    // 3) 必须是可读中文
    expect(body).toContain('当前周缺课已达到 2 次');
    expect(body).toContain('橙色预警');

    // 4) 换行是真实换行，而不是字面量 \n
    expect(body).toContain('\n');
    expect(body).not.toContain('\\n');
  });

  it('渲染参数保留机器码的 warning_level（静默期判定依赖它）', () => {
    // 这条测试锁定的是「不要把 warning_level 本地化」这一约束。
    // 若有人把 warning_level 改成中文，notification-dispatch.service.ts:378
    // 的 canBreakThroughQuietHours 将永远返回 false，红色预警会被静默期吞掉。
    const t = allTemplates.find((x) => x.code === 'ABSENT_THRESHOLD_EMAIL')!;
    const params = { warning_level: 'orange', warning_level_text: '橙色预警' };
    expect(renderTemplate('{warning_level}', params)).toBe('orange');
    expect(renderTemplate('{warning_level_text}', params)).toBe('橙色预警');
    expect(t).toBeDefined();
  });
});
