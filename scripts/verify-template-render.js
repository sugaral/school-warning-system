/**
 * 用「数据库里的真实模板」+「notification_jobs 里的真实参数」渲染，
 * 断言正文没有残留占位符、也没有 week/orange/yellow 这类机器码。
 *
 * 这个脚本正是当初发现「预警级别：yellow」的检查方式 ——
 * 只看代码里的 fallback 字符串会漏掉数据库模板这条真正生效的路径。
 */
const { PrismaClient } = require('@prisma/client');
const { renderTemplate } = require('./dist/shared/template.util.js');

const prisma = new PrismaClient();

const METRIC_CODES = [
  'late', 'absent', 'early_leave', 'leave',
  'homework_not_submit', 'homework_late_submit', 'class_behavior',
  'unacknowledged', 'cumulative', 'failed_courses', 'credits', 'gpa',
];
const LEVEL_CODES = ['yellow', 'orange', 'red', 'severe'];
const WINDOW_CODES = ['day', 'week', 'month', 'term'];

(async () => {
  const jobs = await prisma.notification_jobs.findMany({
    where: { channel: 'email' },
    orderBy: { id: 'desc' },
    take: 40,
  });
  console.log('取到 email 任务数 =', jobs.length);

  let checked = 0;
  const problems = [];

  for (const job of jobs) {
    if (!job.template_code) continue;
    const tpl = await prisma.message_templates.findFirst({
      where: { channel: 'email', template_code: job.template_code, status: 'active' },
    });
    if (!tpl) continue;

    const params = job.params_json || {};
    const body = renderTemplate(tpl.content, params);
    checked++;

    const residual = body.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
    if (residual) {
      problems.push(`job ${job.id} [${job.template_code}] 残留占位符: ${[...new Set(residual)].join(', ')}`);
    }
    // 正文里出现机器码视为缺陷（仅当该任务确实带了文本变体时才算）
    for (const code of [...METRIC_CODES, ...LEVEL_CODES, ...WINDOW_CODES]) {
      const re = new RegExp(`(^|[^a-zA-Z_])${code}([^a-zA-Z_]|$)`);
      if (re.test(body)) {
        problems.push(`job ${job.id} [${job.template_code}] 正文含机器码 "${code}"`);
      }
    }
    if (body.includes('\\n')) {
      problems.push(`job ${job.id} [${job.template_code}] 含字面量 \\n`);
    }

    if (checked <= 3) {
      console.log(`\n--- job ${job.id} [${job.template_code}] ---`);
      console.log(body);
    }
  }

  console.log(`\n=== 渲染检查完成：检查 ${checked} 条，问题 ${problems.length} 条 ===`);
  for (const p of [...new Set(problems)].slice(0, 15)) console.log('  ❌ ' + p);
  if (problems.length === 0) console.log('  ✅ 无残留占位符、无机器码、无字面量 \\n');

  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERR', e); await prisma.$disconnect(); });
