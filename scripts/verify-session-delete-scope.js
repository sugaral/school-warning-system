/**
 * 验证 DELETE /attendance/sessions/:id 的数据范围（越权删除探测）
 *
 * 张老师 = head_teacher, scope=class(1)
 * 李老师 = teacher,      scope=class(2)
 *
 * 修复前该端点没有 @DataScope，handler 里
 *   req?.dataScope || { type: 'all' }
 * 会退化为 all —— 任何有 attendance:manage 的角色都能删任意课次。
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

(async () => {
  const admin = await login('13800138000', 'admin123');
  const head = await login('13800138001', 'teacher123');
  if (!admin || !head) { console.log('登录失败'); process.exit(1); }
  console.log('管理员 + 张老师(head_teacher, class=1) 登录 OK\n');

  // 用管理员在 class=2 建一个课次作为"别人的课次"
  const courses = await call('GET', '/admin/courses', { token: admin });
  const courseList = courses.json?.data?.list || courses.json?.data || [];
  const c2 = courseList.find((x) => String(x.org_id) === '2');
  const mk = await call('POST', '/attendance/sessions', {
    token: admin,
    body: { course_id: String(c2.id), class_id: '2', start_time: '2026-09-12T15:00:00+08:00' },
  });
  const sessionId = mk.json?.data?.session_id;
  console.log(`[1] 管理员为 class=2 建课次: code=${mk.json?.code} session_id=${sessionId}`);
  if (!sessionId) { console.log('建课次失败，无法继续'); process.exit(1); }

  // 张老师（scope=class 1）尝试删除 class=2 的课次
  const del = await call('DELETE', `/attendance/sessions/${sessionId}`, { token: head });
  const denied = del.json?.code === 403 || del.status === 403;
  console.log(
    `[2] 张老师删除外班课次: HTTP ${del.status} code=${del.json?.code} ` +
      `${denied ? '✅ 已拒绝（越权删除被挡）' : '❌ 未拒绝！'}`,
  );
  if (!denied) console.log('    返回:', JSON.stringify(del.json).slice(0, 200));

  // 清理：管理员删掉该课次
  const cleanup = await call('DELETE', `/attendance/sessions/${sessionId}`, { token: admin });
  console.log(`[3] 管理员清理该课次: code=${cleanup.json?.code}`);
})();
