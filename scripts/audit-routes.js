/**
 * 接口清单与覆盖核对表生成器（§13.1 第 1 条 / 13.5 第 4 条）
 *
 * 做法：静态解析 backend/src 下所有 *.controller.ts，提取
 *   @Controller('prefix') + @Get/@Post/@Put/@Delete/@Patch('path')
 * 以及其上的守卫（@UseGuards）、权限（@Permissions）、角色（@Roles），
 * 输出一张 controller × 路由 的完整清单，供逐条测试时打勾。
 *
 * 同时会**实测**每个 GET 路由的连通性（带管理员 token），
 * 区分「路由存在」与「路由可达」，避免只看代码就宣称"已测"。
 *
 * 用法:
 *   node scripts/audit-routes.js                 # 仅静态清单
 *   node scripts/audit-routes.js --probe         # 追加 GET 连通性探测
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'backend', 'src');
const OUT_DIR = path.join(ROOT, 'docs');
const API = process.env.API_BASE || 'http://127.0.0.1:3000';
const PROBE = process.argv.includes('--probe');

function walkControllers(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walkControllers(p, out);
    } else if (e.name.endsWith('.controller.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** 解析单个 controller 文件 */
function parseController(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  // @Controller('x') 或 @Controller()
  const ctrlMatch = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/.exec(text);
  const prefix = ctrlMatch ? (ctrlMatch[1] || ctrlMatch[2] || '') : '';
  const classNameMatch = /export class (\w+)/.exec(text);
  const className = classNameMatch ? classNameMatch[1] : path.basename(file, '.ts');

  // 类级守卫/权限
  const classGuards = [];
  const classGuardMatch = /@UseGuards\(([^)]*)\)/.exec(text);
  if (classGuardMatch) {
    classGuardMatch[1].split(',').forEach((g) => {
      const t = g.trim();
      if (t) classGuards.push(t);
    });
  }

  const routes = [];
  const lines = text.split(/\r?\n/);
  // 局部装饰器缓存（同一路由前的若干行）
  let pending = { guards: [], permissions: [], roles: [], public: false };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/@Public\(\)/.test(trimmed)) pending.public = true;

    const guardM = /@UseGuards\(([^)]*)\)/.exec(trimmed);
    if (guardM) {
      guardM[1].split(',').forEach((g) => {
        const t = g.trim();
        if (t) pending.guards.push(t);
      });
    }

    const permM = /@Permissions\(([^)]*)\)/.exec(trimmed);
    if (permM) pending.permissions.push(permM[1].replace(/['"]/g, '').trim());

    const roleM = /@Roles\(([^)]*)\)/.exec(trimmed);
    if (roleM) pending.roles.push(roleM[1].replace(/['"]/g, '').trim());

    const routeM = /@(Get|Post|Put|Delete|Patch)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/.exec(trimmed);
    if (routeM) {
      const method = routeM[1].toUpperCase();
      const sub = routeM[2] !== undefined ? routeM[2] : routeM[3] !== undefined ? routeM[3] : '';
      // 找后面的 handler 名
      let handler = '';
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const hm = /(?:async\s+)?(\w+)\s*\(/.exec(lines[j].trim());
        if (hm && !/^@/.test(lines[j].trim())) {
          handler = hm[1];
          break;
        }
      }
      const full = ('/' + [prefix, sub].filter(Boolean).join('/')).replace(/\/+/g, '/');
      routes.push({
        controller: className,
        file: rel,
        method,
        path: full,
        handler,
        guards: pending.guards.length ? pending.guards : classGuards,
        permissions: pending.permissions.slice(),
        roles: pending.roles.slice(),
        isPublic: pending.public,
        tested: false,
        result: '',
      });
      pending = { guards: [], permissions: [], roles: [], public: false };
    }
  }

  return { className, prefix, file: rel, routes };
}

async function loginAdmin() {
  const res = await fetch(`${API}/auth/login_admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error('登录失败: ' + json.message);
  return json.data.token;
}

async function main() {
  const files = walkControllers(SRC);
  const controllers = files.map(parseController);
  const allRoutes = controllers.flatMap((c) => c.routes);

  console.log(`controller 文件: ${files.length}`);
  console.log(`路由总数:       ${allRoutes.length}`);
  const byMethod = {};
  for (const r of allRoutes) byMethod[r.method] = (byMethod[r.method] || 0) + 1;
  console.log('按方法:', JSON.stringify(byMethod));

  let probed = 0;
  let reachable = 0;

  if (PROBE) {
    const token = await loginAdmin();
    // 只探测 GET（无副作用），且把路径参数替换为 1 以触发路由匹配
    for (const r of allRoutes) {
      if (r.method !== 'GET') continue;
      const url = API + r.path.replace(/:[A-Za-z_]\w*/g, '1');
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        await res.text();
        r.tested = true;
        // 404 = 路由不存在；其它（200/400/403…）= 路由存在且已响应
        r.result = res.status === 404 ? 'ROUTE_MISSING(404)' : `OK(${res.status})`;
        if (res.status !== 404) reachable++;
        probed++;
      } catch (e) {
        r.tested = true;
        r.result = 'NET_ERROR';
      }
    }
    console.log(`\nGET 路由探测: ${probed} 条，可达 ${reachable} 条`);
  }

  // ---------- 输出 Markdown ----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = [];
  md.push('# 接口清单与覆盖核对表（自动生成）\n');
  md.push('> 生成脚本：`scripts/audit-routes.js`（`--probe` 会实测 GET 连通性）\n');
  md.push(`> 生成时间：${new Date().toISOString()}\n`);
  md.push('## 汇总\n');
  md.push('| 指标 | 数值 |');
  md.push('| --- | --- |');
  md.push(`| Controller 文件数 | ${files.length} |`);
  md.push(`| 路由总数 | ${allRoutes.length} |`);
  md.push(`| GET | ${byMethod.GET || 0} |`);
  md.push(`| POST | ${byMethod.POST || 0} |`);
  md.push(`| PUT | ${byMethod.PUT || 0} |`);
  md.push(`| DELETE | ${byMethod.DELETE || 0} |`);
  md.push(`| PATCH | ${byMethod.PATCH || 0} |`);
  if (PROBE) {
    md.push(`| GET 已实测连通 | ${probed} |`);
    md.push(`| 其中路由存在（非 404） | ${reachable} |`);
  }
  md.push('');
  md.push('> 说明：写操作（POST/PUT/DELETE）**未在探测中调用**，避免污染数据；');
  md.push('> 它们由 `scripts/verify-*` 系列脚本按业务场景实测（幂等/并发/导入导出等）。\n');

  for (const c of controllers) {
    if (c.routes.length === 0) continue;
    md.push(`## ${c.className}  \`${c.prefix || '(无前缀)'}\`\n`);
    md.push('| 方法 | 路径 | Handler | 鉴权 | 权限 | 角色 | 已测 | 结果 |');
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of c.routes) {
      const auth = r.isPublic
        ? 'Public'
        : r.guards.length
          ? r.guards.join('+')
          : '—';
      md.push(
        `| ${r.method} | \`${r.path}\` | ${r.handler} | ${auth} | ${r.permissions.join(',') || '—'} | ${r.roles.join(',') || '—'} | ${r.tested ? 'Y' : ''} | ${r.result} |`,
      );
    }
    md.push('');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'api-coverage.md'), md.join('\n'), 'utf8');
  fs.writeFileSync(
    path.join(OUT_DIR, 'api-coverage.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), controllers: controllers.length, routes: allRoutes }, null, 2),
    'utf8',
  );
  console.log('\n输出: docs/api-coverage.md, docs/api-coverage.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
