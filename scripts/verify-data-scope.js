/**
 * 验证 DataScopeInterceptor 是否真的填充了 request.dataScope
 *
 * 对比两类端点：
 *   A. 带 @DataScope 的（如 GET /admin/classes、GET /admin/students）
 *      → req.dataScope 应被填充，且**按 scope 过滤**数据
 *   B. 不带 @DataScope 的（如 POST /attendance/sessions，本轮已改为自行解析）
 *
 * 判据：同一端点下，班主任（scope=class 1）与系统管理员（scope=all）
 * 返回的数据量应**不同**；若完全相同，说明 scope 未生效。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function login(a, p) {
  const r = await call('POST', '/auth/login_admin', { body: { account: a, password: p } });
  return r.json?.data?.token || null;
}

const countOf = (r) => {
  const d = r.json?.data;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === 'object') {
    if (Array.isArray(d.list)) return d.list.length;
    if (d.total !== undefined) return Number(d.total);
  }
  return 0;
};

(async () => {
  const admin = await login('13800138000', 'admin123');
  const head = await login('13800138001', 'teacher123');
  const teacher = await login('13800138002', 'teacher123');
  if (!admin || !head || !teacher) { console.log('登录失败'); process.exit(1); }

  // 带 @DataScope 的端点
  const endpoints = [
    ['GET', '/admin/classes?page=1&pageSize=100', '班级列表'],
    ['GET', '/admin/students?page=1&pageSize=100', '学生列表'],
    ['GET', '/admin/students/export-accounts?page=1&pageSize=100', '学生账号导出'],
    ['GET', '/admin/course-classes?page=1&pageSize=100', '课程-班级'],
    ['GET', '/admin/warnings/student?page=1&pageSize=100', '学生预警'],
  ];

  console.log('=== 带 @DataScope 端点的 scope 收敛 ===\n');
  for (const [method, path, label] of endpoints) {
    const a = await call(method, path, { token: admin });
    const h = await call(method, path, { token: head });
    const t = await call(method, path, { token: teacher });
    const ca = countOf(a), ch = countOf(h), ct = countOf(t);
    const status = [a.status, h.status, t.status].join('/');
    // 班主任/教师数据量应 <= 管理员
    const scoped = (h.status !== 200 ? true : ch <= ca) && (t.status !== 200 ? true : ct <= ca);
    const differs = ch !== ca || ct !== ca;
    console.log(
      `${label.padEnd(10)} HTTP ${status.padEnd(12)} 管理员=${String(ca).padStart(5)} 班主任=${String(ch).padStart(5)} 教师=${String(ct).padStart(5)}  ${scoped ? '✅ 未越界' : '❌ 越界'}${differs ? ' （scope 生效）' : ' （三者相同，需人工确认）'}`,
    );
  }

  console.log('\n=== 数据范围是否真的被填充（用返回量间接判定）===');
  console.log('若班主任/教师返回量与管理员完全相同，说明 req.dataScope 未被填充。');
})();
