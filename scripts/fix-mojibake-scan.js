/**
 * 乱码中文字面量扫描与修复
 *
 * 成因：UTF-8 中文被当作 GBK/CP936 解码后再按 UTF-8 编码保存，
 * 产生「双重编码损坏」。特征字符大量落在 Unicode 私有区（U+E000–U+F8FF）
 * 与变体选择符（U+FE00–U+FE0F），因此可用码点范围高精度定位。
 *
 * 修复原理（round-trip）：
 *   若原字节流是 UTF-8 的 X，被按 GBK 解码得到字符串 S，
 *   则把 S 按 GBK **重新编码**回字节，再按 UTF-8 解码，即可还原 X。
 *
 * 用法:
 *   node scripts/fix-mojibake-scan.js            # 只扫描报告
 *   node scripts/fix-mojibake-scan.js --fix      # 扫描并就地修复
 */
const fs = require('fs');
const path = require('path');


const ROOT = path.join(__dirname, '..');
const TARGET_DIRS = [
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT, 'backend', 'prisma'),
  path.join(ROOT, 'backend', 'scripts'),
];
const FIX = process.argv.includes('--fix');

/** 可疑码点：私有区、变体选择符 */
function isSuspicious(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0xe000 && c <= 0xf8ff) || // 私有使用区
    (c >= 0xfe00 && c <= 0xfe0f) || // 变体选择符
    (c >= 0xf0000 && c <= 0x10ffff) // 补充私有区
  );
}

/** 定位文件中真正为乱码的行（用 GBK round-trip 验证，避免 emoji 误报） */
function findSuspectLines(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (isRealMojibake(line)) {
      out.push({ line: i + 1, text: line.trim() });
    }
  });
  return out;
}

/**
 * 尝试把一行乱码还原为正确中文。
 *
 * 原理（round-trip）：损坏文本 S 的每个字符，原本是「UTF-8 字节被当作
 * GBK 解码」得到的。因此把 S 按 UTF-8 编码回字节，再按 GBK 解码，
 * 就能得到最初的正确字符串。
 *
 * 用 Node 内置的 TextDecoder('gbk') 实现，**不依赖 Python**
 * （先前版本调用 python -c 时被换行转义破坏，实测直接 SyntaxError）。
 */
const gbkDecoder = new TextDecoder('gbk', { fatal: false });

function tryRepair(line) {
  try {
    const bytes = Buffer.from(line, 'utf8');
    return gbkDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 判定某行是否**真的**是双重编码乱码。
 *
 * ⚠️ 不能只看"含私有区字符"：`⚠️`、`ℹ️` 这类 emoji + 变体选择符
 * 会大量误报（实测首版在 14 个文件里绝大多数是正当 emoji）。
 * 可靠判据是**能否 round-trip 还原出可读中文**。
 */
function isRealMojibake(line) {
  if (!/[\uE000-\uF8FF]/.test(line)) return false; // 私有区是双重编码的强特征
  const repaired = tryRepair(line);
  if (!repaired || repaired === line) return false;
  const hasChinese = /[\u4e00-\u9fa5]/.test(repaired);
  const stillBroken = /[\uE000-\uF8FF\uFFFD]/.test(repaired);
  return hasChinese && !stillBroken;
}

/** 递归收集 .ts 文件 */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function main() {
  const files = TARGET_DIRS.flatMap((d) => walk(d));
  let totalSuspect = 0;
  const report = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const suspects = findSuspectLines(text);
    if (suspects.length === 0) continue;

    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    report.push({ file: rel, lines: suspects });
    totalSuspect += suspects.length;

    if (FIX) {
      // 逐处尝试修复：把整行按 GBK round-trip 还原
      let newText = text;
      for (const s of suspects) {
        const repaired = tryRepair(s.text);
        if (repaired && repaired !== s.text) {
          newText = newText.split(s.text).join(repaired);
        }
      }
      if (newText !== text) {
        fs.writeFileSync(file, newText, 'utf8');
        console.log(`  [已修复] ${rel} (${suspects.length} 行)`);
      } else {
        console.log(`  [无法自动修复] ${rel} (${suspects.length} 行) — 需人工确认`);
      }
    }
  }

  console.log('\n=== 乱码扫描结果 ===');
  console.log(`扫描文件: ${files.length}`);
  console.log(`含乱码文件: ${report.length}`);
  console.log(`含乱码行: ${totalSuspect}`);
  if (report.length > 0 && !FIX) {
    console.log('\n明细:');
    for (const r of report) {
      console.log(`  ${r.file}`);
      for (const l of r.lines.slice(0, 4)) {
        console.log(`    L${l.line}: ${l.text.slice(0, 100)}`);
      }
    }
    console.log('\n提示：加 --fix 尝试自动还原（GBK round-trip）');
  }
}

main();
