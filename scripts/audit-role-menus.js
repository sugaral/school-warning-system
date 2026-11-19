/**
 * 角色 × 菜单 × 页面 覆盖核对表生成器（§13.1 第 2 条 / 13.5 第 5 条）
 *
 * 做法（静态走查 + 交叉校验，不依赖浏览器）：
 *  1. 解析 src/config/menus.ts 的 roleMenuConfig → 每个角色的菜单树
 *  2. 解析 src/router.ts 的 children 路由 → path → 组件
 *  3. 交叉校验三类问题：
 *     a. **菜单指向未注册路由**（点了 404）
 *     b. **组件文件不存在**（构建期漏文件）
 *     c. **已注册但无任何角色菜单可达**（死页面）
 *  4. 输出 role × menu × page 覆盖表
 *
 * ⚠️ 明确标注：本表为**源码走查**结果，未做真实浏览器点击
 *    （本机无 Playwright/浏览器环境）。按钮级覆盖见「按钮清单」章节，
 *    由源码中 @click / handleXxx 静态提取，属"存在性核对"而非"可点击验证"。
 *
 * 用法: node scripts/audit-role-menus.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FE = path.join(ROOT, 'admin-frontend', 'src');
const OUT_DIR = path.join(ROOT, 'docs');

/** ---------- 1. 解析 menus.ts ---------- */
function parseMenus() {
  const text = fs.readFileSync(path.join(FE, 'config', 'menus.ts'), 'utf8');
  const lines = text.split(/\r?\n/);

  const roles = [];
  let cur = null;
  let depth = 0; // 用于识别 menus: [ ... ] 块

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const roleM = /^\s{4}role:\s*'([^']+)'/.exec(line);
    if (roleM) {
      cur = { role: roleM[1], title: '', menus: [] };
      roles.push(cur);
      continue;
    }
    const titleM = /^\s{4}title:\s*'([^']+)'/.exec(line);
    if (titleM && cur) {
      cur.title = titleM[1];
      continue;
    }

    // 菜单项：{ path: '/x', name: '…' }  也可能带 children: [...]
    const itemM = /\{\s*path:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'/.exec(line);
    if (itemM && cur) {
      cur.menus.push({ path: itemM[1], name: itemM[2] });
    }
    // 少数菜单写成 { path: '...', name: '...', children: [ ... ] } 多行形式
    const childM = /path:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'/.exec(line);
    if (childM && cur && !itemM) {
      if (!cur.menus.some((m) => m.path === childM[1])) {
        cur.menus.push({ path: childM[1], name: childM[2] });
      }
    }
    void depth;
  }
  return roles;
}

/** ---------- 2. 解析 router.ts ---------- */
function parseRouter() {
  const text = fs.readFileSync(path.join(FE, 'router.ts'), 'utf8');

  // 收集 import 的组件名 → 源文件
  const imports = new Map();
  const importRe = /import\s+(\w+)\s+from\s+'([^']+)'/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    imports.set(m[1], m[2]);
  }

  // children 内的路由：path 是相对路径（不带 /）
  const routes = new Map(); // '/my-warnings' -> { name, component, file }
  const childRe = /\{\s*path:\s*'([^']+)'[^}]*?name:\s*'([^']+)'[^}]*?component:\s*(?:\(\)\s*=>\s*import\('([^']+)'\)|(\w+))/g;
  while ((m = childRe.exec(text)) !== null) {
    const rawPath = m[1];
    const name = m[2];
    const dynFile = m[3];
    const compName = m[4];
    let file = dynFile || '';
    if (!file && compName && imports.has(compName)) {
      file = imports.get(compName);
    }
    // children 的相对路径 → 绝对路径
    const abs = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    routes.set(abs, { name, file: file || '' });
  }

  // 顶层绝对路径路由（/login、/register 等）
  const topRe = /\{\s*path:\s*'(\/[^']+)'[^}]*?component:\s*(?:\(\)\s*=>\s*import\('([^']+)'\)|(\w+))/g;
  while ((m = topRe.exec(text)) !== null) {
    const abs = m[1];
    const dynFile = m[2];
    const compName = m[3];
    let file = dynFile || '';
    if (!file && compName && imports.has(compName)) file = imports.get(compName);
    if (!routes.has(abs)) routes.set(abs, { name: abs, file: file || '' });
  }

  return routes;
}

/** 解析文件中的 @click / 事件绑定，提取按钮清单（存在性核对） */
function extractButtons(fileRel) {
  if (!fileRel) return [];
  const p = path.resolve(FE, fileRel);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf8');
  const names = new Set();

  // template 中的 @click="handler"
  const clickRe = /@click(?:\.\w+)?\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = clickRe.exec(text)) !== null) {
    names.add(m[1].trim());
  }
  // el-button 的文本（粗略提取，用于展示）
  const btnRe = /<el-button[^>]*>\s*([^<{]{1,16}?)\s*<\/el-button>/g;
  while ((m = btnRe.exec(text)) !== null) {
    const label = m[1].trim();
    if (label && /[\u4e00-\u9fa5]/.test(label)) names.add('按钮:' + label);
  }
  return [...names];
}

function main() {
  const roles = parseMenus();
  const routes = parseRouter();

  // 校验
  const brokenLinks = []; // 菜单指向未注册路由
  const missingFiles = []; // 组件文件不存在
  const reachable = new Set(); // 有菜单可达的路由

  const rows = [];
  for (const r of roles) {
    for (const item of r.menus) {
      const route = routes.get(item.path);
      let pageFile = '';
      let status = 'OK';
      if (!route) {
        status = '菜单指向未注册路由';
        brokenLinks.push(`${r.role} → ${item.path} (${item.name})`);
      } else {
        pageFile = route.file;
        reachable.add(item.path);
        if (pageFile) {
          const abs = path.resolve(FE, pageFile);
          if (!fs.existsSync(abs)) {
            status = '组件文件不存在';
            missingFiles.push(`${item.path} → ${pageFile}`);
          }
        } else {
          // 组件指向某个 import 的常量名，无法解析文件时标注
          status = '组件文件未解析';
        }
      }
      rows.push({
        role: r.role,
        roleTitle: r.title,
        menuName: item.name,
        menuPath: item.path,
        pageFile: pageFile || '—',
        status,
        buttons: extractButtons(pageFile).length,
      });
    }
  }

  // 死页面：已注册但无任何菜单可达
  const deadPages = [];
  for (const [p, info] of routes.entries()) {
    if (p === '/login' || p === '/register') continue;
    if (!reachable.has(p)) deadPages.push(`${p} (${info.file || info.name})`);
  }

  // ---------- 输出 ----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = [];
  md.push('# 角色 × 菜单 × 页面 覆盖核对表（自动生成）\n');
  md.push('> 生成脚本：`scripts/audit-role-menus.js`\n');
  md.push(`> 生成时间：${new Date().toISOString()}\n`);
  md.push('> ⚠️ **本表为源码走查结果，未做真实浏览器点击**（本机无浏览器环境）。');
  md.push('> 按钮列为源码中 `@click` / `<el-button>` 的**存在性**统计，非"可点击验证"。\n');

  md.push('## 汇总\n');
  md.push('| 指标 | 数值 |');
  md.push('| --- | --- |');
  md.push(`| 角色数（roleMenuConfig） | ${roles.length} |`);
  md.push(`| 路由总数（router.ts） | ${routes.size} |`);
  md.push(`| 角色-菜单条目总数 | ${rows.length} |`);
  md.push(`| 唯一菜单路径数 | ${new Set(rows.map((r) => r.menuPath)).size} |`);
  md.push(`| 菜单指向未注册路由 | ${brokenLinks.length} |`);
  md.push(`| 组件文件缺失 | ${missingFiles.length} |`);
  md.push(`| 死页面（已注册但无菜单可达） | ${deadPages.length} |`);
  md.push('');

  if (brokenLinks.length) {
    md.push('## ⚠️ 菜单指向未注册路由（点击会 404）\n');
    brokenLinks.forEach((b) => md.push(`- ${b}`));
    md.push('');
  }
  if (missingFiles.length) {
    md.push('## ⚠️ 组件文件缺失\n');
    missingFiles.forEach((b) => md.push(`- ${b}`));
    md.push('');
  }
  if (deadPages.length) {
    md.push('## ⚠️ 死页面（已注册但任何角色菜单都不可达）\n');
    deadPages.forEach((b) => md.push(`- ${b}`));
    md.push('');
  }

  md.push('## 按角色展开\n');
  for (const r of roles) {
    const items = rows.filter((x) => x.role === r.role);
    md.push(`### ${r.title}（\`${r.role}\`）— ${items.length} 个菜单\n`);
    md.push('| 菜单 | 路径 | 页面文件 | 源码按钮数 | 状态 |');
    md.push('| --- | --- | --- | --- | --- |');
    for (const it of items) {
      md.push(
        `| ${it.menuName} | \`${it.menuPath}\` | ${it.pageFile.replace('./', '')} | ${it.buttons} | ${it.status} |`,
      );
    }
    md.push('');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'role-menu-coverage.md'), md.join('\n'), 'utf8');

  console.log('=== 角色菜单覆盖核对完成 ===');
  console.log(`角色数:              ${roles.length}`);
  console.log(`路由数:              ${routes.size}`);
  console.log(`角色-菜单条目:        ${rows.length}`);
  console.log(`唯一菜单路径:         ${new Set(rows.map((r) => r.menuPath)).size}`);
  console.log(`菜单指向未注册路由:   ${brokenLinks.length}`);
  console.log(`组件文件缺失:         ${missingFiles.length}`);
  console.log(`死页面:              ${deadPages.length}`);
  if (brokenLinks.length) {
    console.log('\n未注册路由（点击会 404）:');
    brokenLinks.slice(0, 20).forEach((b) => console.log('  - ' + b));
  }
  if (deadPages.length) {
    console.log('\n死页面:');
    deadPages.slice(0, 20).forEach((b) => console.log('  - ' + b));
  }
  console.log('\n输出: docs/role-menu-coverage.md');
}

main();
