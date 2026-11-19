/**
 * 源码编码完整性检查（严格）
 *
 * 背景：本轮排查导出下载 500 时，PowerShell 控制台把中文**显示**成乱码
 * （`鎶ヨ〃鐢熸垚澶辫触`），一度让我以为源码损坏。为彻底排除，
 * 这里做三重校验：
 *   1. 严格 UTF-8 解码（fatal: true）—— 文件必须是合法 UTF-8
 *   2. 不得含 U+FFFD（替换字符，损坏的铁证）
 *   3. 不得含"UTF-8 被按 GBK 解码"的产物（用 GBK 编码非法性反推）
 *
 * 第 3 条的做法：把文件里每个非 ASCII 片段按 latin1 取回字节、
 * 尝试 UTF-8 解码；若**成功且结果含中文**，说明该片段很可能是
 * "UTF-8 被误读再存回"的产物（正常中文按 latin1 取字节后无法解成 UTF-8）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT, 'backend', 'prisma'),
  path.join(ROOT, 'admin-frontend', 'src'),
  path.join(ROOT, 'miniprogram'),
  path.join(ROOT, 'scripts'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p, out);
    } else if (/\.(ts|vue|js|json|wxml|wxss|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

let files = 0;
let invalidUtf8 = [];
let hasReplacement = [];
let suspectGbk = [];
let nonAsciiFiles = 0;

for (const file of DIRS.flatMap((d) => walk(d))) {
  files += 1;
  const raw = fs.readFileSync(file);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  // 1. 严格 UTF-8
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    invalidUtf8.push(rel);
    continue;
  }

  // 2. 替换字符
  if (text.includes('\uFFFD')) hasReplacement.push(rel);

  // 3. GBK 误读产物
  //
  // ⚠️ 不能只看"latin1 取字节后能 UTF-8 解码"：正常中文偶尔也会满足
  //   （实测 `日报记录` 就能解出 `奰U`），属误报。
  //
  // 真正的 GBK 误读有明确判据：原文里会混入**GBK 特有区段**的汉字
  //   —— 主要是 U+93xx–U+94xx（如 鎶 鏁 鐢 鍒），这些字在正常中文技术
  //   文本中几乎不出现。因此要求"还原结果含中文"**且**"原文含 >=2 个
  //   U+9000–U+9FFF 生僻区的不同字"，才判定为损坏。
  if (/[^\x00-\x7F]/.test(text)) nonAsciiFiles += 1;
  const segs = text.match(/[^\x00-\x7F]{4,}/g) || [];
  let suspect = 0;
  for (const seg of segs) {
    const rare = new Set(
      [...seg].filter((c) => {
        const cp = c.codePointAt(0);
        return cp >= 0x9000 && cp <= 0x9fff;
      }),
    );
    if (rare.size < 2) continue;
    try {
      const dec = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(seg, 'latin1'));
      if (/[\u4e00-\u9fa5]/.test(dec) && dec !== seg) suspect += 1;
    } catch {
      /* 正常中文走这里 */
    }
  }
  if (suspect > 0) suspectGbk.push(`${rel} (${suspect} 段)`);
}

console.log('=== 源码编码完整性检查 ===');
console.log(`扫描文件数        : ${files}`);
console.log(`含非 ASCII 的文件 : ${nonAsciiFiles}`);
console.log(`非法 UTF-8 文件   : ${invalidUtf8.length}`);
console.log(`含 U+FFFD 的文件  : ${hasReplacement.length}`);
console.log(`疑似 GBK 误读文件 : ${suspectGbk.length}`);

if (invalidUtf8.length) { console.log('\n❌ 非法 UTF-8:'); invalidUtf8.forEach((f) => console.log('   ' + f)); }
if (hasReplacement.length) { console.log('\n❌ 含替换字符:'); hasReplacement.forEach((f) => console.log('   ' + f)); }
if (suspectGbk.length) { console.log('\n❌ 疑似 GBK 误读:'); suspectGbk.forEach((f) => console.log('   ' + f)); }

const ok = !invalidUtf8.length && !hasReplacement.length && !suspectGbk.length;
console.log(`\n结论: ${ok ? '✅ 全部源码为合法 UTF-8，无损坏迹象' : '❌ 发现编码损坏'}`);
process.exit(ok ? 0 : 1);
