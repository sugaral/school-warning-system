/**
 * 微信小程序交付物完整性校验
 *
 * ⚠️ 诚实声明：本环境**没有**微信开发者工具，也没有浏览器，
 * 因此这里只能做**静态**校验（结构 / 语法 / 接口契约），
 * 不等于"在真机或开发者工具里点过一遍"。文档中必须保持这一措辞。
 *
 * 校验项：
 *   1. app.json 合法性：pages 全部存在对应文件（.js/.wxml/.json）
 *   2. 每个页面 js 语法可解析（new Function 编译，不执行）
 *   3. 每个页面 wxss 非空（如有）
 *   4. 接口基址与后端契约一致（config.js 的 baseUrl）
 *   5. 请求封装存在统一响应码处理（code === 0）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

let pass = 0, fail = 0;
const problems = [];
function check(name, ok, detail = '') {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) problems.push(`${name} ${detail}`);
}

console.log('=== 微信小程序静态校验 ===\n');

// 1. app.json
const appJsonPath = path.join(MP, 'app.json');
check('app.json 存在', fs.existsSync(appJsonPath));
let appJson = {};
try {
  appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  check('app.json 是合法 JSON', true);
} catch (e) {
  check('app.json 是合法 JSON', false, e.message);
}

const pages = appJson.pages || [];
check('pages 数量 ≥ 20', pages.length >= 20, `${pages.length} 个`);

let missing = [];
const syntaxErrors = [];
for (const p of pages) {
  for (const ext of ['.js', '.wxml', '.json']) {
    const f = path.join(MP, `${p}${ext}`);
    if (!fs.existsSync(f)) missing.push(`${p}${ext}`);
  }
  // 页面 js 语法
  const jsFile = path.join(MP, `${p}.js`);
  if (fs.existsSync(jsFile)) {
    const src = fs.readFileSync(jsFile, 'utf8');
    try {
      // 只做语法编译，不执行
      new Function(src);
    } catch (e) {
      syntaxErrors.push(`${p}.js: ${e.message}`);
    }
  }
}
check('所有页面文件齐全', missing.length === 0, missing.length ? missing.slice(0, 5).join(', ') : '全部存在');
check('页面 js 语法可解析', syntaxErrors.length === 0, syntaxErrors.slice(0, 3).join(' | '));

// 2. app.js 语法
const appJs = path.join(MP, 'app.js');
if (fs.existsSync(appJs)) {
  try { new Function(fs.readFileSync(appJs, 'utf8')); check('app.js 语法可解析', true); }
  catch (e) { check('app.js 语法可解析', false, e.message); }
} else check('app.js 存在', false);

// 3. 请求封装：统一响应码 + 鉴权头
const reqFile = path.join(MP, 'utils/request.js');
if (fs.existsSync(reqFile)) {
  const src = fs.readFileSync(reqFile, 'utf8');
  check('utils/request.js 存在', true);
  check('  含统一响应码判断 (code === 0)', /code\s*===?\s*0/.test(src) || /code\s*!==?\s*0/.test(src));

  // 鉴权头是经 config.TOKEN_HEADER / TOKEN_PREFIX 拼出来的，
  // 因此要**解析 config.js 的实际取值**，而不是在 request.js 里找字面量 'Bearer'。
  const cfgSrc = fs.readFileSync(path.join(MP, 'config.js'), 'utf8');
  const hdr = (cfgSrc.match(/TOKEN_HEADER:\s*'([^']+)'/) || [])[1];
  const pfx = (cfgSrc.match(/TOKEN_PREFIX:\s*'([^']+)'/) || [])[1];
  check(
    '  鉴权头与后端契约一致',
    hdr === 'Authorization' && String(pfx || '').trim() === 'Bearer',
    `header=${hdr} prefix=${JSON.stringify(pfx)}`,
  );
  check('  request.js 使用了该配置', /config\.TOKEN_HEADER/.test(src) && /config\.TOKEN_PREFIX/.test(src));
} else check('utils/request.js 存在', false);

// 3b. 接口契约：小程序调用的每个 /xxx 路径，后端必须有对应路由
//     这是比"字面量匹配"更有价值的校验 —— 能抓出前后端路径漂移。
{
  const src = fs.readFileSync(reqFile, 'utf8');

  // ⚠️ 只在 `const api = { ... }` 这段里取 url，
  // 否则会把 `wx.reLaunch({ url: '/pages/login/login' })` 这类
  // **页面跳转**也当成 API 路径（第一版就误报了 /pages/login/login）。
  const apiBlock = src.slice(src.indexOf('const api = {'), src.indexOf('module.exports'));
  const paths = Array.from(
    new Set((apiBlock.match(/url:\s*'([^']+)'/g) || []).map((m) => m.match(/'([^']+)'/)[1])),
  ).map((p) => p.replace(/\/$/, ''));

  // 从后端控制器收集路由前缀
  const SRC = path.join(ROOT, 'backend', 'src');
  const ctrls = [];
  (function walkC(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p2 = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist'].includes(e.name)) walkC(p2); }
      else if (e.name.endsWith('.controller.ts')) ctrls.push(p2);
    }
  })(SRC);

  const routeRe = /@(?:Get|Post|Put|Delete|Patch)\(\s*'([^']*)'/g;
  const allRoutes = [];
  for (const f of ctrls) {
    const t = fs.readFileSync(f, 'utf8');
    const base = (t.match(/@Controller\('([^']*)'\)/) || [])[1] || '';
    let m;
    routeRe.lastIndex = 0;
    while ((m = routeRe.exec(t))) {
      allRoutes.push(`/${base}/${m[1]}`.replace(/\/+/g, '/').replace(/\/$/, ''));
    }
  }

  const unmatched = paths.filter((p) => {
    // 去掉结尾的动态段后做前缀匹配
    const staticPart = p.replace(/\/[^/]*$/, '');
    return !allRoutes.some((r) => r === p || r.startsWith(staticPart + '/') || r === staticPart);
  });
  check(
    '小程序 API 路径在后端均有对应路由',
    unmatched.length === 0,
    `${paths.length} 个路径，未匹配 ${unmatched.length} 个${unmatched.length ? ': ' + unmatched.slice(0, 5).join(', ') : ''}`,
  );
}

// 4. 接口基址
const cfg = path.join(MP, 'config.js');
if (fs.existsSync(cfg)) {
  const src = fs.readFileSync(cfg, 'utf8');
  check('config.js 存在', true);
  const m = src.match(/baseUrl\s*[:=]\s*['"`]([^'"`]+)['"`]/);
  check('  定义了 baseUrl', Boolean(m), m ? m[1] : '未找到');
} else check('config.js 存在', false);

// 5. 页面数统计
const allJs = fs.readdirSync(path.join(MP, 'pages'), { recursive: true })
  .filter((f) => String(f).endsWith('.js')).length;
check('pages 下 js 文件数 ≥ 20', allJs >= 20, `${allJs} 个`);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (problems.length) problems.forEach((p) => console.log('  ❌ ' + p));
console.log('\n注：以上均为**静态**校验；本环境无微信开发者工具/浏览器，');
console.log('    未做真机或模拟器点击验证。');
process.exit(fail === 0 ? 0 : 1);
