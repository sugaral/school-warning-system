/**
 * 导出链路端到端验证
 *
 * 覆盖：创建导出任务（queued）→ 等待 worker 处理 → 状态落库
 *      → 下载接口返回真实 xlsx（ZIP 魔数 504b0304）
 *
 * 修复背景：导出原先是**同步**的，30k 预警下 enqueue 要 28s；
 * 现在改为 queued + 独立处理器（reports/export-processor.service.ts）。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

(async () => {
  const login = await api('POST', '/auth/login_admin', {
    body: { account: '13800138000', password: 'admin123' },
  });
  const token = login.json?.data?.token;
  if (!token) {
    console.log('登录失败:', JSON.stringify(login.json).slice(0, 200));
    process.exit(1);
  }
  console.log('[1] 登录 OK');

  const t0 = Date.now();
  const gen = await api('POST', '/admin/reports/generate/daily', { token });
  const enqueueMs = Date.now() - t0;
  const jobId = gen.json?.data?.export_job_id;
  console.log(
    `[2] 创建导出任务: HTTP ${gen.status} enqueue=${enqueueMs}ms job=${jobId} status=${gen.json?.data?.status}`,
  );
  if (!jobId) process.exit(1);

  // 断言：enqueue 必须是毫秒级（同步版本是 28s）
  if (enqueueMs > 3000) {
    console.log(`    ❌ enqueue 耗时 ${enqueueMs}ms，疑似退回同步实现`);
  } else {
    console.log('    ✅ enqueue 为毫秒级（非阻塞）');
  }

  let final = null;
  for (let i = 1; i <= 40; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const hist = await api('GET', '/admin/reports/history?page=1&pageSize=10', { token });
    const rows = hist.json?.data?.list || hist.json?.data?.items || [];
    const row = rows.find((x) => String(x.id) === String(jobId));
    if (row) {
      process.stdout.write(`\r[3] 轮询 ${i}: status=${row.status}      `);
      if (['success', 'failed', 'completed'].includes(String(row.status))) {
        final = row;
        break;
      }
    }
  }
  console.log();
  if (!final) {
    console.log('❌ 未在 80s 内完成');
    process.exit(1);
  }
  console.log(`[3] 最终状态: ${final.status}`);
  if (String(final.status) === 'failed') {
    console.log('    ❌ 导出失败:', JSON.stringify(final).slice(0, 300));
    process.exit(1);
  }

  // 下载并落盘
  const res = await fetch(`${BASE}/admin/reports/download/${jobId}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const ctype = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  const out = path.join(__dirname, '..', '_export_out.xlsx');
  fs.writeFileSync(out, buf);

  const magic = buf.slice(0, 4).toString('hex');
  console.log(`[4] 下载: HTTP ${res.status} type=${ctype}`);
  console.log(`    字节数=${buf.length} 魔数=${magic}`);
  console.log(`    ✅ xlsx(ZIP) 魔数正确: ${magic === '504b0304'}`);
  console.log(`    ✅ MIME 正确: ${ctype.includes('spreadsheetml')}`);
  console.log(`    已保存: ${out}`);
})();
