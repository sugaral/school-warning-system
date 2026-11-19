/**
 * 模板占位符一致性审计（P1-11）
 *
 * 问题背景：
 *   P1-11 指出「renderTemplate 之外的模板变量清单不一致：seed.ts 与代码 fallback
 *   使用了模板中未列出的变量 → 渲染结果缺字段」。
 *
 * 做法：把三处的占位符全部抽出来做交叉比对
 *   1. 数据库 message_templates.content（实际下发的模板）
 *   2. backend/prisma/seed.ts 中写入的模板字面量
 *   3. backend/src 内 fallback 文案（warning.service / auth.controller / config.controller 等）
 * 并与 §8.3 规定的内置占位符清单比对，输出：
 *   - 三处都在用、但 §8.3 未登记的变量（"清单漏登记"）
 *   - §8.3 登记了、但没有任何模板使用的变量（"登记了没用"）
 *   - seed 与 DB 不一致（seed 改了但库没同步）
 *
 * 注意：本脚本**不修改任何文件**，只产出报告；修复由人工确认后执行，
 *       因为"该用哪个变量名"涉及业务语义，不能机械替换。
 *
 * 用法: node scripts/audit-template-vars.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'backend', 'src');
const OUT_DIR = path.join(ROOT, 'docs');

/**
 * §8.3 规定的内置占位符清单（原样逐字抄自任务书，**不得修改**）
 *
 * 保留原始清单的意义：它是"需求侧"的银证。若代码/模板用到清单外的变量，
 * 那是任务书漏登记（spec drift），应记录而不是偷偷把清单补齐 —— 否则
 * 审计就失去发现"需求与实现不一致"的能力。
 */
const SPEC_VARS = [
  'student_name', 'student_no', 'student_email', 'class_name', 'org_name',
  'level', 'level_cn', 'warning_level', 'warning_level_cn',
  'window', 'window_cn', 'warning_window', 'warning_window_cn',
  'metric', 'metric_cn', 'violation_type', 'violation_type_cn',
  'trigger_summary', 'warning_reason', 'violation_count', 'absent_count',
  'period_start', 'period_end', 'date', 'time', 'timestamp',
  'code', 'expire_minutes', 'system_name', 'school_name', 'head_teacher_name', 'email',
];

/**
 * 运行时**真实可渲染**的占位符集合 = SPEC_VARS + 实现侧补充。
 *
 * 补充项及依据（P1-11）：
 *  - late_count / absent_count 之外的分指标计数：模板 ORANGE_WARNING 直接
 *    使用 `{late_count}`；warning.service.ts 的 buildCountParams() 从
 *    warnings.trigger_detail_json 动态注入，指标名即变量名。
 *  - warning_level_text / warning_window_text：显示用中文文本变体。
 *    `warning_window` / `warning_level` 按契约保存机器码（week / orange），
 *    因为 notification-dispatch.service.ts:378 依赖 params.warning_level
 *    判定 red/severe 是否突破静默期，所以模板要显示中文必须走 *_text。
 *
 * 回归防线：backend/src/config/message-templates.contract.spec.ts 会断言
 * "所有默认模板用到的变量都在渲染参数里"，本脚本负责"清单侧"的核对。
 */
const RUNTIME_EXTRA_VARS = ['late_count', 'warning_level_text', 'warning_window_text'];

const RUNTIME_VARS = [...SPEC_VARS, ...RUNTIME_EXTRA_VARS];

/**
 * 占位符正则。
 *
 * ⚠️ 踩过的坑：最初写成 /\\?\{([A-Za-z0-9_]+)\}/g，结果把 JS 模板字符串
 * 的 `${var}` 也当成占位符（`{var}` 部分被匹配），一次性报出 227 个
 * "未登记变量"，绝大多数是 x/y/i/start/where 这类普通局部变量 —— 全是误报。
 *
 * 正确做法：
 *  1. 排除 `${`（模板字符串插值）；
 *  2. 排除 `{{`（Vue/小程序模板）；
 *  3. 只统计**看起来像业务占位符**的形态：置于引号内的模板字面量，
 *     或含下划线的多词键（业务占位符几乎都带下划线，如 student_name）。
 */
const PLACEHOLDER_RE = /(?<!\$)(?<!\{)\\\{([A-Za-z][A-Za-z0-9_]*)\\\}|\{([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\}/g;

function extractVars(text) {
  const found = new Set();
  // 逐行处理并跳过注释行：注释里的示例（如 `warn:idem:{userId}:{key}`）
  // 不是真实模板，否则会污染审计结论。
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    // 含 JS 模板字符串插值的行直接跳过，避免把局部变量名当占位符。
    // （典型误报：`${name_prefix}${studentIndex}` 会被抽出 name_prefix）
    if (rawLine.indexOf('${') !== -1) continue;
    PLACEHOLDER_RE.lastIndex = 0;
    let m;
    while ((m = PLACEHOLDER_RE.exec(rawLine)) !== null) {
      const v = m[1] || m[2];
      if (v) found.add(v);
    }
  }
  return found;
}

/** 递归收集 .ts 文件 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 从数据库读取模板（mysql 在容器内） */
function readDbTemplates() {
  try {
    const out = execSync(
      `docker exec warnsys-mysql mysql -uroot -p${process.env.MYSQL_ROOT_PASSWORD || ''} --default-character-set=utf8mb4 -N -e "SELECT CONCAT(template_code,'|',channel,'|',REPLACE(content,'\\n','\\\\n')) FROM warnsys.message_templates;" 2>nul`,
      { encoding: 'utf8', timeout: 60000 },
    );
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [code, channel, ...rest] = line.split('|');
        return { code, channel, content: rest.join('|') };
      });
  } catch (e) {
    return null; // 容器不可用时降级为仅静态扫描
  }
}

function main() {
  const report = { dbVars: new Map(), seedVars: new Map(), srcVars: new Map() };

  // ---------- 1. 数据库模板 ----------
  const dbTemplates = readDbTemplates();
  const dbAll = new Set();
  if (dbTemplates) {
    for (const t of dbTemplates) {
      const vars = extractVars(t.content);
      vars.forEach((v) => {
        dbAll.add(v);
        if (!report.dbVars.has(v)) report.dbVars.set(v, []);
        report.dbVars.get(v).push(`${t.code}(${t.channel})`);
      });
    }
  }

  // ---------- 2. seed.ts ----------
  const seedFile = path.join(ROOT, 'backend', 'prisma', 'seed.ts');
  const seedText = fs.existsSync(seedFile) ? fs.readFileSync(seedFile, 'utf8') : '';
  const seedAll = extractVars(seedText);
  seedAll.forEach((v) => report.seedVars.set(v, ['seed.ts']));

  // ---------- 3. src 内所有字面量（含 fallback） ----------
  const srcAll = new Set();
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    // 只挑"看起来像模板"的字符串：含 {xxx}
    for (const v of extractVars(text)) {
      srcAll.add(v);
      if (!report.srcVars.has(v)) report.srcVars.set(v, []);
      if (report.srcVars.get(v).length < 4) report.srcVars.get(v).push(rel);
    }
  }

  const specSet = new Set(SPEC_VARS);
  const runtimeSet = new Set(RUNTIME_VARS);
  const usedAnywhere = new Set([...dbAll, ...seedAll, ...srcAll]);

  // 硬缺陷：用了，但运行时**根本渲染不出来**（调用方没传值）
  const unregistered = [...usedAnywhere].filter((v) => !runtimeSet.has(v)).sort();
  // 规格漂移：能渲染，但任务书 §8.3 清单没登记（需求侧漏写）
  const specDrift = [...usedAnywhere]
    .filter((v) => runtimeSet.has(v) && !specSet.has(v))
    .sort();
  const unusedInSpec = SPEC_VARS.filter((v) => !usedAnywhere.has(v)).sort();

  // ---------- 输出 ----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = [];
  md.push('# 模板占位符一致性审计（P1-11）\n');
  md.push('> 生成脚本：`scripts/audit-template-vars.js`（只读审计，不修改文件）\n');
  md.push(`> 生成时间：${new Date().toISOString()}\n`);
  md.push('## 汇总\n');
  md.push('| 指标 | 数值 |');
  md.push('| --- | --- |');
  md.push(`| §8.3 任务书规定清单 | ${SPEC_VARS.length} |`);
  md.push(`| 运行时实际可渲染集合（清单+实现补充） | ${RUNTIME_VARS.length} |`);
  md.push(`| 数据库模板中实际使用 | ${dbAll.size} |`);
  md.push(`| seed.ts 中出现 | ${seedAll.size} |`);
  md.push(`| src 代码中出现（含 fallback） | ${srcAll.size} |`);
  md.push(`| **三处合计使用** | **${usedAnywhere.size}** |`);
  md.push(`| 🔴 使用但运行时不可渲染（硬缺陷） | ${unregistered.length} |`);
  md.push(`| 🟡 可渲染但 §8.3 未登记（规格漂移） | ${specDrift.length} |`);
  md.push(`| §8.3 登记但无任何模板使用 | ${unusedInSpec.length} |`);
  md.push('');

  if (unregistered.length > 0) {
    md.push('## 🔴 使用中但运行时不可渲染（必须修）\n');
    md.push('> 这些变量会被模板引用，但**没有任何调用方传值** ——');
    md.push('> `renderTemplate` 对未知占位符保留原样，学生/管理员会收到');
    md.push('> 字面量 `{xxx}`。这就是 P0-1 的真实故障形态。\n');
    md.push('| 变量 | 数据库模板 | seed | src（前几处） |');
    md.push('| --- | --- | --- | --- |');
    for (const v of unregistered) {
      md.push(
        `| \`{${v}}\` | ${(report.dbVars.get(v) || []).join(', ') || '—'} | ${seedAll.has(v) ? 'Y' : '—'} | ${(report.srcVars.get(v) || []).slice(0, 2).join('<br>') || '—'} |`,
      );
    }
    md.push('');
  } else {
    md.push('## ✅ 无"运行时不可渲染"的占位符\n');
    md.push('> 三处（数据库模板 / seed.ts / src fallback）使用的全部变量，');
    md.push('> 都能在渲染参数里找到对应键。\n');
  }

  if (specDrift.length > 0) {
    md.push('## 🟡 可渲染但 §8.3 任务书清单未登记（规格漂移）\n');
    md.push('> 实现侧已提供这些变量（见本脚本 `RUNTIME_EXTRA_VARS`），');
    md.push('> 但任务书 §8.3 的内置清单没有它们。属于**需求侧漏写**，');
    md.push('> 不是代码缺陷；记录在此以免下次审计误判为回归。\n');
    md.push('| 变量 | 数据库模板 | seed | src（前几处） |');
    md.push('| --- | --- | --- | --- |');
    for (const v of specDrift) {
      md.push(
        `| \`{${v}}\` | ${(report.dbVars.get(v) || []).join(', ') || '—'} | ${seedAll.has(v) ? 'Y' : '—'} | ${(report.srcVars.get(v) || []).slice(0, 2).join('<br>') || '—'} |`,
      );
    }
    md.push('');
  }

  if (unusedInSpec.length > 0) {
    md.push('## §8.3 已登记但当前无模板使用\n');
    md.push('| 变量 | 说明 |');
    md.push('| --- | --- |');
    for (const v of unusedInSpec) md.push(`| \`{${v}}\` | 清单内、暂无模板引用 |`);
    md.push('');
    md.push('> 这不算缺陷：清单是"能力声明"，允许模板按需引用。但若长期无人用，');
    md.push('> 需确认调用方是否真的传了对应参数，否则模板作者一用就会渲染成原样占位符。\n');
  }

  md.push('## 数据库模板逐条占位符\n');
  if (dbTemplates) {
    md.push('| 模板 | 渠道 | 占位符 |');
    md.push('| --- | --- | --- |');
    for (const t of dbTemplates) {
      const vars = [...extractVars(t.content)];
      md.push(`| ${t.code} | ${t.channel} | ${vars.length ? vars.map((v) => `{${v}}`).join(' ') : '—'} |`);
    }
  } else {
    md.push('_（数据库容器不可用，未采集）_');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'template-vars-audit.md'), md.join('\n'), 'utf8');

  console.log('=== 模板占位符审计完成 ===');
  console.log(`§8.3 任务书清单:         ${SPEC_VARS.length}`);
  console.log(`运行时可渲染集合:        ${RUNTIME_VARS.length}`);
  console.log(`数据库模板使用:          ${dbAll.size}`);
  console.log(`seed.ts 出现:           ${seedAll.size}`);
  console.log(`src 代码出现:            ${srcAll.size}`);
  console.log(`三处合计:               ${usedAnywhere.size}`);
  console.log(`🔴 运行时不可渲染:        ${unregistered.length}  ${unregistered.join(', ') || '（无）'}`);
  console.log(`🟡 §8.3 未登记(规格漂移): ${specDrift.length}  ${specDrift.join(', ') || '（无）'}`);
  console.log(`§8.3 登记但未使用:       ${unusedInSpec.length}  ${unusedInSpec.join(', ')}`);
  console.log('\n输出: docs/template-vars-audit.md');
}

main();
