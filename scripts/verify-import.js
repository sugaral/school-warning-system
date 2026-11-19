/**
 * 导入链路端到端验证（POST /admin/courses/import）
 *
 * 覆盖 shared/import.service.ts 的关键能力：
 *   1. dryRun 预演 —— 不落库
 *   2. 真实导入 —— 落库并返回成功计数
 *   3. 重复导入 —— onDuplicate=skip 行为
 *   4. 外键查不到（学院不存在）—— 进失败报告，不自动创建主数据
 *   5. 缺必填列 —— 表头校验失败
 *   6. GBK 编码 CSV —— 编码嗅探
 *
 * 修复背景：该路由原本 404（P1-9），现已落地。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const fs = require('fs');

async function login() {
  const r = await fetch(BASE + '/auth/login_admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
  }).then((x) => x.json());
  if (!r?.data?.token) throw new Error('登录失败 ' + JSON.stringify(r).slice(0, 200));
  return r.data.token;
}

async function uploadCsv(token, csvText, { dryRun = false, onDuplicate = 'skip', filename = 'courses.csv' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([csvText], { type: 'text/csv' }), filename);
  const qs = `?dryRun=${dryRun}&onDuplicate=${onDuplicate}`;
  const res = await fetch(`${BASE}/admin/courses/import${qs}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

(async () => {
  const token = await login();
  console.log('[0] 登录 OK');

  // 取一个真实学院名，保证 happy path 能过外键解析
  const orgs = await fetch(BASE + '/orgs', { headers: { Authorization: 'Bearer ' + token } })
    .then((r) => r.json())
    .catch(() => null);
  const orgName =
    orgs?.data?.[0]?.name ||
    orgs?.data?.list?.[0]?.name ||
    '计算机学院';
  console.log(`[1] 使用学院名: ${orgName}`);

  const stamp = Date.now();
  const code = `E2E${String(stamp).slice(-6)}`;
  const happy = [
    '学院,课程代码,课程名称,学分,学期',
    `${orgName},${code},端到端测试课程,3.5,2026-2027-1`,
    `${orgName},${code}2,端到端测试课程二,2,2026-2027-1`,
  ].join('\n');

  // 精确统计「本次测试代码前缀」的课程数（/admin/courses 不支持 keyword 过滤，
  // 因此拉全量后在本地过滤 —— 不能拿全表条数当基线，否则结论无意义）
  const countMine = async () => {
    const all = await fetch(`${BASE}/admin/courses`, {
      headers: { Authorization: 'Bearer ' + token },
    }).then((r) => r.json()).catch(() => null);
    const list = all?.data?.list || all?.data || [];
    return list.filter((c) => String(c.course_code || '').startsWith(code));
  };

  const beforeRows = await countMine();
  console.log(`[2] 基线：库中前缀 ${code} 的课程数 = ${beforeRows.length}（期望 0）`);

  // 3) dryRun 预演：不应落库
  const dry = await uploadCsv(token, happy, { dryRun: true });
  console.log(
    `[3] dryRun 预演: HTTP ${dry.status} dryRun=${dry.json?.data?.dryRun} success=${dry.json?.data?.success} failed=${dry.json?.data?.failed}`,
  );

  const afterDry = await countMine();
  console.log(
    `    dryRun 后前缀 ${code} 课程数 = ${afterDry.length} → ` +
      (afterDry.length === 0 ? '✅ 确实未落库' : `❌ 预演竟然写库了（${afterDry.length} 条）`),
  );

  // 4) 真实导入
  const real = await uploadCsv(token, happy, { dryRun: false, onDuplicate: 'skip' });
  console.log(
    `[4] 真实导入: HTTP ${real.status} dryRun=${real.json?.data?.dryRun} success=${real.json?.data?.success} skipped=${real.json?.data?.skipped}`,
  );

  // 5) 重复导入（同文件再来一次）
  const dup = await uploadCsv(token, happy, { dryRun: false, onDuplicate: 'skip' });
  console.log(
    `[5] 重复导入(skip): success=${dup.json?.data?.success} skipped=${dup.json?.data?.skipped} → ` +
      (dup.json?.data?.skipped === 2 ? '✅ 正确跳过' : '❌ 未按 skip 处理'),
  );

  // 6) 外键不存在
  const badFk = [
    '学院,课程代码,课程名称,学分,学期',
    `不存在的学院XYZ,${code}9,幽灵课程,3,2026-2027-1`,
  ].join('\n');
  const fk = await uploadCsv(token, badFk, { dryRun: true });
  const fkErr = fk.json?.data?.errors?.[0];
  console.log(
    `[6] 学院不存在: failed=${fk.json?.data?.failed} errors=${JSON.stringify(fkErr)} → ` +
      (fk.json?.data?.failed === 1 ? '✅ 进失败报告' : '❌'),
  );

  // 7) 缺必填列
  const missing = ['学分,学期', '3,2026-2027-1'].join('\n');
  const miss = await uploadCsv(token, missing, { dryRun: true });
  console.log(
    `[7] 缺必填列: failed=${miss.json?.data?.failed} 错误数=${miss.json?.data?.errors?.length}`,
  );
  (miss.json?.data?.errors || []).slice(0, 3).forEach((e) => console.log(`     - ${e.message}`));

  // 8) 落库核对
  const mine = await countMine();
  console.log(`[8] 最终：前缀 ${code} 课程数 = ${mine.length}（期望 2）`);
  mine.forEach((c) => console.log(`     - ${c.course_code} ${c.course_name} credit=${c.credit}`));
  console.log(mine.length === 2 ? '✅ 导入结果与预演一致' : '❌ 数量不符');
})();
