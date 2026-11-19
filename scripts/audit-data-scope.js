/**
 * 审计：带 :id 的写操作端点是否挂 @DataScope，并按"实体类型"分类风险。
 *
 * 判定逻辑：
 *   1. 扫所有 controller 里 @Delete/@Put/@Post 且路径含 :id 的方法
 *   2. 向上找同方法的 @DataScope / @Permissions / @Roles
 *   3. 依据路径前缀推断该 :id 指向的实体（student/class/org/session/warning/...）
 *   4. 输出分类结果，便于按业务判断"该不该挂"
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'backend', 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'dist'].includes(e.name)) walk(p, out);
    } else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

/** 按资源路径推断 :id 的实体归属 */
function inferEntity(httpMethod, fullPath) {
  const p = fullPath.toLowerCase();
  if (/student/.test(p)) return 'student';
  if (/class/.test(p) && !/class-?sessions/.test(p)) return 'class';
  if (/session/.test(p)) return 'session';
  if (/warning/.test(p)) return 'warning';
  if (/course/.test(p)) return 'course';
  if (/teacher/.test(p)) return 'teacher';
  if (/org|college|major/.test(p)) return 'org';
  if (/user|roles?|permission/.test(p)) return 'system(全局)';
  if (/schedule/.test(p)) return 'schedule';
  if (/grade/.test(p)) return 'grade';
  if (/leave|makeup|appeal|request|approval/.test(p)) return 'request';
  if (/rule|config|template|exclusion|feedback|audit|report/.test(p)) return 'system(全局)';
  return 'unknown';
}

/** 该实体是否"按人/班/院隔离" —— 即是否**需要**数据范围 */
function needsScope(entity) {
  return ['student', 'class', 'session', 'warning', 'schedule', 'grade', 'request'].includes(entity);
}

const rows = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const controllerMatch = text.match(/@Controller\('([^']*)'\)/);
  const base = controllerMatch ? controllerMatch[1] : '';

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/@(Delete|Put|Post|Patch)\('([^']*:id[^']*)'\)/);
    if (!m) continue;
    const httpMethod = m[1].toUpperCase();
    const routePath = m[2];

    // 向上扫，收集**同一方法**的装饰器。
    //
    // ⚠️ 不能"遇到上一个装饰器就 break"：装饰器是成组出现的
    //    @Post(...) / @Permissions(...) / @DataScope(...)
    //    从 @Post 行往上扫其实扫不到 @DataScope（它在下面）。
    //    正确做法：以本行为锚点，向下扫到方法签名为止，
    //    因为装饰器组整体位于方法签名的**上方**、@Post 行的**下方**。
    let hasScope = false;
    let permissions = '';
    let roles = '';
    for (let j = i; j < Math.min(lines.length, i + 14); j++) {
      const l = lines[j];
      if (l.includes('@DataScope')) hasScope = true;
      const pm = l.match(/@Permissions\('([^']+)'\)/);
      if (pm) permissions = pm[1];
      const rm = l.match(/@Roles\(([^)]*)\)/);
      if (rm) roles = rm[1].replace(/['\s]/g, '');
      // 方法签名：`async xxx(` 或 `xxx(` 且不是装饰器行
      if (/^\s*(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(l) && !l.trim().startsWith('@')) break;
      // 撞到下一个路由装饰器说明方法已结束
      if (j > i && /@(Get|Delete|Put|Post|Patch)\(/.test(l)) break;
    }

    const fullPath = `/${base}/${routePath}`.replace(/\/+/g, '/');
    const entity = inferEntity(httpMethod, fullPath);
    rows.push({
      file: path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/'),
      line: i + 1,
      method: httpMethod,
      fullPath,
      hasScope,
      permissions,
      roles,
      entity,
      needs: needsScope(entity),
    });
  }
}

const missing = rows.filter((r) => !r.hasScope);
const missingNeeded = missing.filter((r) => r.needs);
const missingGlobal = missing.filter((r) => !r.needs);
const covered = rows.filter((r) => r.hasScope);

console.log('=== 汇总 ===');
console.log(`含 :id 的写操作端点总数      : ${rows.length}`);
console.log(`已挂 @DataScope             : ${covered.length}`);
console.log(`未挂 @DataScope             : ${missing.length}`);
console.log(`  ├─ 其中"按人/班/院隔离"应为高危: ${missingNeeded.length}`);
console.log(`  └─ 其中全局/系统类（可能无需范围）: ${missingGlobal.length}`);

console.log('\n=== 🔴 未挂范围但属"按人/班/院隔离"的端点（需逐条判断）===');
const byEntity = {};
for (const r of missingNeeded) {
  (byEntity[r.entity] ||= []).push(r);
}
for (const [entity, list] of Object.entries(byEntity).sort()) {
  console.log(`\n--- entity=${entity} (${list.length}) ---`);
  for (const r of list) {
    console.log(`  ${r.method.padEnd(6)} ${r.fullPath.padEnd(52)} perm=${(r.permissions || r.roles || '-').padEnd(22)} ${r.file.split('/').pop()}:${r.line}`);
  }
}

console.log('\n=== ⚪ 未挂范围但属全局/系统类（大概率无需范围）===');
for (const r of missingGlobal) {
  console.log(`  ${r.method.padEnd(6)} ${r.fullPath.padEnd(52)} ${r.file.split('/').pop()}:${r.line}`);
}
