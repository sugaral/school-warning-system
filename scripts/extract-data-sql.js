/**
 * 从 mysqldump 全量导出中抽取「纯数据」语句，用于把基线数据导入由
 * `prisma db push` 建立的干净 schema。
 *
 * 背景：仓库自带的基线 dump 缺少 5 张快照/缓存表，且其 _prisma_migrations
 * 中记录的是本仓库不存在的迁移名（如 20260325124921_848_10），
 * 因此不能直接用 `prisma migrate deploy` 复现该库。
 * 正确做法：db push 建全 46 表 → 只灌数据。
 *
 * 用法: node scripts/extract-data-sql.js <dump.sql> > data-only.sql
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node extract-data-sql.js <dump.sql>');
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');

// 关闭外键/唯一检查，保证导入顺序无关
const out = [
  'SET NAMES utf8mb4;',
  'SET FOREIGN_KEY_CHECKS=0;',
  'SET UNIQUE_CHECKS=0;',
  'SET SQL_MODE=\'NO_AUTO_VALUE_ON_ZERO\';',
];

let count = 0;
const skipped = [];

// 逐条匹配 INSERT 语句（支持跨行的多值插入，以 ; 结尾）
const re = /^INSERT INTO .*?;\s*$/gms;
let m;
while ((m = re.exec(sql)) !== null) {
  const stmt = m[0];
  const table = (stmt.match(/^INSERT INTO `?([A-Za-z0-9_]+)`?/) || [])[1];
  if (table === '_prisma_migrations') {
    skipped.push(table);
    continue;
  }
  out.push(stmt);
  count++;
}

out.push('SET FOREIGN_KEY_CHECKS=1;', 'SET UNIQUE_CHECKS=1;');

process.stderr.write(`extracted ${count} INSERT statements\n`);
if (skipped.length) {
  process.stderr.write(`skipped tables: ${[...new Set(skipped)].join(', ')}\n`);
}

process.stdout.write(out.join('\n') + '\n');
