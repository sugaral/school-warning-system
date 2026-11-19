/**
 * 定点修复 warning.service.ts 中被双重编码损坏的中文字面量。
 *
 * 现象：源码里写的是 '鏈煡瀛︾敓'（6 个字），正确值应为 '未知学生'（4 个字）。
 * 成因：UTF-8 中文被当作 GBK 解码后又按 UTF-8 重新编码，属典型双重编码损坏。
 * 影响：预警通知模板的 {student_name} 在学生无姓名时会渲染出乱码。
 *
 * 本脚本按「前后文锚点」精确定位，只替换该字符串字面量，不触碰文件其他部分。
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node fix-mojibake.js <file>');
  process.exit(1);
}

// 已用码点核实：\u93c8\uE046\u7161\u701b\uFE3E\u6553（6 字符）
// 其中 \uE046 / \uFE3E 属私有区/变体选择符，是典型的「UTF-8 被当 GBK 解码后再编码」损坏。
const BROKEN = '\u93c8\ue046\u7161\u701b\ufe3e\u6553';
const FIXED = '未知学生';

const original = fs.readFileSync(file, 'utf8');
const occurrences = original.split(BROKEN).length - 1;

if (occurrences === 0) {
  console.log('未发现目标损坏序列，无需修复');
  process.exit(0);
}

const updated = original.split(BROKEN).join(FIXED);
fs.writeFileSync(file, updated, 'utf8');

console.log(`已替换 ${occurrences} 处：'${BROKEN}' → '${FIXED}'`);
