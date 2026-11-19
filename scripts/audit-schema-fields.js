/**
 * 字段「零浪费」审计（§4 要求产出 324 行核对表）
 *
 * 做法：解析 prisma/schema.prisma 得到每张表每个字段，再对 backend/src
 * 全量扫描该字段的**写入点**（prisma.<model>.create/update/upsert 的 data 里出现）
 * 与**读取点**（select / orderBy / where 中出现），输出：
 *   - 完整核对表（CSV + Markdown）
 *   - 「僵尸字段」清单（既无写入也无读取）
 *   - 「只写不读」清单（有写入但从未被读出，等于白存）
 *
 * 这样得出的结论是可复现的，而不是靠人工浏览印象。
 *
 * 用法: node scripts/audit-schema-fields.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA = path.join(ROOT, 'backend', 'prisma', 'schema.prisma');
const SRC = path.join(ROOT, 'backend', 'src');
/**
 * 额外扫描目录：seed / 手工脚本也是真实的写入方。
 * 漏掉它们会把「只被 seed 写入、运行期从不读取」的字段误判为完全僵尸，
 * 两者结论不同（前者是"初始化后即休眠"，后者是"从未被使用"）。
 */
const EXTRA_DIRS = [path.join(ROOT, 'backend', 'prisma'), path.join(ROOT, 'backend', 'scripts')];
const OUT_DIR = path.join(ROOT, 'docs');

/** 30 张「基线表」（需求 §4 指定的原始表） */
const BASELINE_TABLES = new Set([
  'orgs', 'classes', 'users', 'student_profiles', 'user_roles',
  'change_requests', 'auth_challenges', 'security_events', 'files',
  'courses', 'course_classes', 'class_sessions', 'attendance_records', 'daily_records',
  'leave_requests', 'makeup_requests', 'appeals',
  'weekly_summaries', 'monthly_summaries', 'term_summaries', 'grades',
  'warning_rules', 'calendar_exclusions', 'warnings',
  'message_templates', 'notification_jobs', 'notification_logs',
  'export_jobs', 'audit_logs', 'idempotency_keys',
]);

/** 解析 schema：返回 [{ model, fields: [{name, type}] }] */
function parseSchema() {
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const lines = text.split(/\r?\n/);
  const models = [];
  let cur = null;
  for (const line of lines) {
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (m) {
      cur = { model: m[1], fields: [] };
      models.push(cur);
      continue;
    }
    if (cur && /^\}/.test(line)) {
      cur = null;
      continue;
    }
    if (cur) {
      const trimmed = line.trim();
      // 跳过块属性（@@index / @@map ...）、注释、空行
      if (!trimmed || trimmed.startsWith('@@') || trimmed.startsWith('//')) continue;
      // 字段行形如：  name   Type   @attr  （type 可能带 ? 或 []）
      const f = /^(\w+)\s+(\w+(?:\[\])?\??)/.exec(trimmed);
      if (f) {
        cur.fields.push({ name: f[1], type: f[2] });
      }
    }
  }
  return models;
}

/** 收集 backend/src 与 seed/scripts 下所有 .ts 内容（排除 spec 与 node_modules） */
function collectSources() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        walk(p);
      } else if (e.name.endsWith('.ts')) {
        files.push({ path: p, rel: path.relative(ROOT, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  walk(SRC);
  for (const d of EXTRA_DIRS) walk(d);
  return files;
}

/**
 * 判断某字段在某文件中的使用形态（静态文本扫描，启发式）。
 *  - 写入：字段名以 `field:` 形式出现，且该文件存在 create/update/upsert/data
 *  - 读取：字段名以 `.field` 属性访问出现，或作为 select/orderBy 的键
 *
 * ⚠️ 已知局限（务必在结论中一并说明，不要把它当精确数据流分析）：
 *  1. 无法识别 `include: { relation: true }` 拉取整表后按属性名访问的场景
 *     （例如 orgs 的 parent_org_id 若只通过 relation 读取就检测不到）；
 *  2. 同名变量/字符串字面量会造成误判；
 *  3. 因此本表用于**发现可疑字段**，结论需人工复核后再定性。
 */
function analyseField(fieldName, sources) {
  const writeFiles = [];
  const readFiles = [];
  const bareRe = new RegExp(`\\b${fieldName}\\b`);

  for (const src of sources) {
    const t = src.text;
    if (!bareRe.test(t)) continue;

    const writeContext =
      new RegExp(`\\b${fieldName}\\s*:`).test(t) &&
      /\.(create|createMany|update|updateMany|upsert)\s*\(|data\s*:\s*\{/.test(t);
    const readContext =
      new RegExp(`\\.${fieldName}\\b`).test(t) ||
      new RegExp(`\\b${fieldName}\\s*:\\s*true`).test(t) || // select: { field: true }
      new RegExp(`${fieldName}\\s*:\\s*(asc|desc)`).test(t); // orderBy

    if (writeContext) writeFiles.push(src.rel);
    if (readContext) readFiles.push(src.rel);
  }

  return {
    writers: [...new Set(writeFiles)],
    readers: [...new Set(readFiles)],
  };
}

function main() {
  const models = parseSchema();
  const sources = collectSources();

  const rows = [];
  let baselineFieldCount = 0;
  let zombie = [];
  let writeOnly = [];

  for (const m of models) {
    const isBaseline = BASELINE_TABLES.has(m.model);
    for (const f of m.fields) {
      // 只排除「关系/导航字段」，保留标量列。
      //
      // ⚠️ 踩过的坑：最初写成 /^[A-Z]/ 判断「首字母大写即关系」，
      // 结果把 BigInt / String / DateTime / Json / Decimal 这些**标量类型
      // 也全过滤掉了**（它们同样首字母大写），541 个字段只剩 30 个。
      // 正确做法：用「是否是已知标量类型」来判定。
      const SCALAR_TYPES = new Set([
        'String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean',
        'DateTime', 'Json', 'Bytes',
      ]);
      const baseType = String(f.type).replace(/\[\]$/, '').replace(/\?$/, '');
      const isRelation = !SCALAR_TYPES.has(baseType);
      if (isRelation) continue;

      const { writers, readers } = analyseField(f.name, sources);
      const status =
        writers.length === 0 && readers.length === 0
          ? '僵尸字段'
          : writers.length === 0
            ? '只读'
            : readers.length === 0
              ? '只写不读'
              : '已使用';

      if (isBaseline) baselineFieldCount++;

      const row = {
        table: m.model,
        field: f.name,
        type: f.type,
        baseline: isBaseline ? 'Y' : 'N',
        writers: writers.slice(0, 3).join(' '),
        readers: readers.slice(0, 3).join(' '),
        status,
      };
      rows.push(row);

      if (isBaseline) {
        if (status === '僵尸字段') zombie.push(row);
        else if (status === '只写不读') writeOnly.push(row);
      }
    }
  }

  // ---------- 输出 CSV ----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const csvHeader = 'table,field,type,baseline,status,writers,readers\n';
  const csvBody = rows
    .map((r) =>
      [r.table, r.field, r.type, r.baseline, r.status, `"${r.writers}"`, `"${r.readers}"`].join(','),
    )
    .join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'schema-field-audit.csv'), csvHeader + csvBody, 'utf8');

  // ---------- 输出 Markdown ----------
  const md = [];
  md.push('# 数据库字段「零浪费」核对表（自动生成）\n');
  md.push(`> 生成脚本：\`scripts/audit-schema-fields.js\`（可重复执行、结果可复现）\n`);
  md.push(`> 生成时间：${new Date().toISOString()}\n`);
  md.push('## 汇总\n');
  md.push('| 指标 | 数值 |');
  md.push('| --- | --- |');
  md.push(`| Schema 中的表（model）总数 | ${models.length} |`);
  md.push(`| 基线表（需求 §4 指定的 30 张） | ${BASELINE_TABLES.size} |`);
  md.push(`| 全部非关系字段总数 | ${rows.length} |`);
  md.push(`| **基线表字段数** | **${baselineFieldCount}** |`);
  md.push(`| 状态=已使用 | ${rows.filter((r) => r.status === '已使用').length} |`);
  md.push(`| 状态=只写不读 | ${rows.filter((r) => r.status === '只写不读').length} |`);
  md.push(`| 状态=只读 | ${rows.filter((r) => r.status === '只读').length} |`);
  md.push(`| 状态=僵尸字段 | ${rows.filter((r) => r.status === '僵尸字段').length} |`);
  md.push('');
  md.push('> 说明：静态扫描为启发式判定。`只读`/`只写不读` 多为该表由系统任务或迁移写入、');
  md.push('> 或字段仅参与查询条件，属正常形态；`僵尸字段` 才是需要重点关注的。\n');

  if (zombie.length > 0) {
    md.push('## ⚠️ 僵尸字段（既无写入也无读取）\n');
    md.push('| 表 | 字段 | 类型 | 是否基线表 |');
    md.push('| --- | --- | --- | --- |');
    for (const r of zombie) md.push(`| ${r.table} | ${r.field} | ${r.type} | ${r.baseline} |`);
    md.push('');
  }

  if (writeOnly.length > 0) {
    md.push('## 只写不读（有写入但未发现读取点）\n');
    md.push('| 表 | 字段 | 写入方（前 3） |');
    md.push('| --- | --- | --- |');
    for (const r of writeOnly) md.push(`| ${r.table} | ${r.field} | ${r.writers} |`);
    md.push('');
  }

  md.push('## 基线表逐字段核对\n');
  md.push('| 表 | 字段 | 类型 | 写入方 | 读取方 | 状态 |');
  md.push('| --- | --- | --- | --- | --- | --- |');
  const baselineModels = models.filter((m) => BASELINE_TABLES.has(m.model)).map((m) => m.model);
  for (const model of baselineModels) {
    for (const r of rows.filter((x) => x.table === model)) {
      md.push(
        `| ${r.table} | ${r.field} | ${r.type} | ${r.writers || '—'} | ${r.readers || '—'} | ${r.status} |`,
      );
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'schema-field-audit.md'), md.join('\n'), 'utf8');

  console.log('=== 字段审计完成 ===');
  console.log(`全部非关系字段: ${rows.length}`);
  console.log(`基线表字段:     ${baselineFieldCount}（需求称 324）`);
  console.log(`已使用:         ${rows.filter((r) => r.status === '已使用').length}`);
  console.log(`只写不读:       ${rows.filter((r) => r.status === '只写不读').length}`);
  console.log(`只读:           ${rows.filter((r) => r.status === '只读').length}`);
  console.log(`僵尸字段:       ${rows.filter((r) => r.status === '僵尸字段').length}`);
  console.log(`\n输出: docs/schema-field-audit.md, docs/schema-field-audit.csv`);
}

main();
