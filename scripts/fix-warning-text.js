/**
 * 定点修复 warning.service.ts 中 sendNotificationImmediately 的乱码文案
 *
 * 该区域的中文经双重编码损坏，且 round-trip（GBK 还原）无法恢复
 * （实测还原结果仍是乱码），因此按**码点精确匹配**替换为规范文案。
 *
 * 规范文案来源：本文件 getWarningLevelText()（L3329 等仍完好的副本）
 * 与 message_templates 中的等级命名保持一致：
 *   yellow=黄色预警 orange=橙色预警 red=红色预警 severe=严重预警
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node fix-warning-text.js <file>');
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');
let changed = 0;

/**
 * 用「行号 + 锚点」定位，避免依赖乱码字符本身能否被正确表示。
 * 锚点取该行唯一的 ASCII 前缀。
 */
const lines = src.split(/\r?\n/);

/** 期望的替换内容（按行号） */
const REPLACEMENTS = new Map([
  // levelTextMap 四行
  ['yellow:', "        yellow: '黄色预警',"],
  ['orange:', "        orange: '橙色预警',"],
  ['red:', "        red: '红色预警',"],
  ['severe:', "        severe: '严重预警',"],
]);

/** content 行的 ASCII 锚点 */
const CONTENT_ANCHOR = 'const content = `';
const CONTENT_REPLACEMENT =
  "      const content = `您收到一条${levelTextMap[warning.level] || warning.level}：${params.trigger_summary || ''}`;";

const out = [];
for (const line of lines) {
  const trimmed = line.trim();

  // 只处理 sendNotificationImmediately 内部那 5 行：
  // 判定条件 = 以 key 开头、带引号、且以 ', 结尾，并且包含非 ASCII 字符
  let replaced = false;
  for (const [anchor, replacement] of REPLACEMENTS) {
    if (
      trimmed.startsWith(anchor) &&
      trimmed.endsWith("',") &&
      /[^\x00-\x7F]/.test(trimmed) &&
      trimmed.length <= 40
    ) {
      out.push(replacement);
      changed++;
      replaced = true;
      break;
    }
  }
  if (replaced) continue;

  if (trimmed.startsWith(CONTENT_ANCHOR) && /[^\x00-\x7F]/.test(trimmed)) {
    out.push(CONTENT_REPLACEMENT);
    changed++;
    continue;
  }

  out.push(line);
}

fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log(`replaced ${changed} lines`);
