/**
 * 把三个导出端点的同步统计改为非阻塞（P1-7 补充）
 *
 * 背景：generate/daily、weekly、monthly、semester 在返回前都会 `await`
 * 统计聚合。压测实测该聚合在 30k 预警规模下需 20s+，使用户点「导出」后
 * 仍要等十几秒 —— 这抵消了把导出改成异步队列的意义。
 *
 * 本脚本仅做局部替换：
 *   const data = await this.getXxxStats(...);  →  void this.refreshReportStatsInBackground(...)
 *   data: { ...data, export_job_id: X }        →  data: { export_job_id: X, status: X.status }
 */
const fs = require('fs');

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
let edits = 0;

// 1) daily
src = src.replace(
  /const data = await this\.getDailyStats\(range\.startLabel, normalizedStatus, scope, normalizedOrgId\);/,
  "void this.refreshReportStatsInBackground('daily', range.startLabel, () =>\n        this.getDailyStats(range.startLabel, normalizedStatus, scope, normalizedOrgId),\n      );",
);
edits++;

// 2) monthly
src = src.replace(
  /const data = await this\.getMonthlyStats\(range\.monthLabel, normalizedStatus, scope, normalizedOrgId\);/,
  "void this.refreshReportStatsInBackground('monthly', range.monthLabel, () =>\n        this.getMonthlyStats(range.monthLabel, normalizedStatus, scope, normalizedOrgId),\n      );",
);
edits++;

// 3) semester
src = src.replace(
  /const data = await this\.getSemesterStats\(range\.semesterLabel, normalizedStatus, scope, normalizedOrgId\);/,
  "void this.refreshReportStatsInBackground('semester', range.semesterLabel, () =>\n        this.getSemesterStats(range.semesterLabel, normalizedStatus, scope, normalizedOrgId),\n      );",
);
edits++;

// 4) 统一响应体：不再展开 data
const before = src;
src = src.replace(
  /data: \{\s*\n\s*\.\.\.data,\s*\n\s*export_job_id: exportJob\.id\.toString\(\),\s*\n\s*\},/g,
  'data: {\n          export_job_id: exportJob.id.toString(),\n          status: exportJob.status,\n        },',
);
if (src !== before) edits++;

fs.writeFileSync(file, src, 'utf8');
console.log(`applied ${edits} edit groups`);

// 验证
const remaining = (src.match(/const data = await this\.get\w+Stats\(/g) || []).length;
const spreads = (src.match(/\.\.\.data,/g) || []).length;
console.log(`remaining sync stats calls: ${remaining} (期望 0)`);
console.log(`remaining ...data spreads: ${spreads} (期望 0)`);
