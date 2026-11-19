/**
 * 验证：createSession 的数据范围与参数校验（本轮修复）
 *
 * 修复前两个缺陷：
 *   1. 缺 @DataScope → req.dataScope 永远 undefined，任何有
 *      attendance:manage 的角色都能给**任意班级**开签到课次（越权写入）
 *   2. start_time 不校验 → Invalid Date 传进 Prisma 抛 500
 *
 * 张老师 = head_teacher, scope_type=class, scope_id=1
 * 李老师 = teacher,      scope_type=class, scope_id=2
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

async function login(account, password) {
  const r = await call('POST', '/auth/login_admin', { body: { account, password } });
  return r.json?.data?.token || null;
}

(async () => {
  const headToken = await login('13800138001', 'teacher123'); // 张老师 scope=class(1)
  const adminToken = await login('13800138000', 'admin123');
  if (!headToken || !adminToken) { console.log('登录失败'); process.exit(1); }
  console.log('张老师(head_teacher, class=1) 与 系统管理员 登录 OK\n');

  // 取课程与班级
  const courses = await call('GET', '/admin/courses', { token: adminToken });
  const courseList = courses.json?.data?.list || courses.json?.data || [];
  const classesRes = await call('GET', '/admin/classes?page=1&pageSize=10', { token: adminToken });
  const classList = classesRes.json?.data?.list || classesRes.json?.data || [];
  console.log('班级：', classList.map((c) => `${c.id}:${c.class_name}(org=${c.org_id})`).join(' | '));

  const class1 = classList.find((c) => String(c.id) === '1');
  const class2 = classList.find((c) => String(c.id) === '2');

  const start = '2026-09-12T10:00:00+08:00';

  // 1) 张老师给自己班（class 1）开课次 —— 应允许
  if (class1) {
    const c = courseList.find((x) => String(x.org_id) === String(class1.org_id));
    const r = await call('POST', '/attendance/sessions', {
      token: headToken,
      body: { course_id: String(c.id), class_id: '1', start_time: start },
    });
    const ok = r.json?.code === 0;
    console.log(`[1] 张老师给本班(class=1)开课次: code=${r.json?.code} ${ok ? '✅ 允许' : '❌ 被误拒: ' + r.json?.message}`);
  }

  // 2) 张老师给别人的班（class 2）开课次 —— 应拒绝（修复前会成功！）
  if (class2) {
    const c = courseList.find((x) => String(x.org_id) === String(class2.org_id));
    const r = await call('POST', '/attendance/sessions', {
      token: headToken,
      body: { course_id: String(c.id), class_id: '2', start_time: start },
    });
    const denied = r.json?.code === 403;
    console.log(
      `[2] 张老师给外班(class=2)开课次: code=${r.json?.code} ${denied ? '✅ 已拒绝（越权写入被挡）' : '❌ 未拒绝: ' + r.json?.message}`,
    );
  }

  // 3) start_time 校验（修复前是 500）
  for (const [label, val] of [['非法字符串', 'not-a-date'], ['空', ''], ['时间戳', '1789000000000'], ['越界 1970', '1970-01-01']]) {
    const c = courseList.find((x) => String(x.org_id) === String(class1?.org_id));
    const r = await call('POST', '/attendance/sessions', {
      token: adminToken,
      body: { course_id: String(c.id), class_id: '1', start_time: val },
    });
    const good = r.json?.code === 400;
    console.log(`[3] start_time=${label.padEnd(8)} → code=${r.json?.code} ${good ? '✅ 400（修复前 500）' : '❌'} ${String(r.json?.message).slice(0, 50)}`);
  }
})();
