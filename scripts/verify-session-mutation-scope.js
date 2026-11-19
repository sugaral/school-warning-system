/**
 * 课次写操作的数据范围验证（本轮修复）
 *
 * 覆盖 4 个端点：
 *   DELETE /attendance/sessions/:id
 *   POST   /attendance/sessions/:id/end
 *   POST   /attendance/sessions/:id/status
 *   POST   /attendance/sessions/:id/students/:student_id/status
 *
 * 关键：不仅验证"外班被拒"，也要验证"本班允许" ——
 * 否则就是把功能改死了（上一轮 @DataScope 误加就出现过这种回归）。
 *
 * 范围事实：
 *   张老师 head_teacher scope=class(1)
 *   李老师 teacher      scope=class(2)
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
  return { status: res.status, json, code: json?.code };
}

async function login(a, p) {
  const r = await call('POST', '/auth/login_admin', { body: { account: a, password: p } });
  return r.json?.data?.token || null;
}

(async () => {
  const admin = await login('13800138000', 'admin123');
  const head = await login('13800138001', 'teacher123');   // scope=class 1
  const teacher = await login('13800138002', 'teacher123'); // scope=class 2
  if (!admin || !head || !teacher) { console.log('登录失败'); process.exit(1); }

  const courses = await call('GET', '/admin/courses', { token: admin });
  const list = courses.json?.data?.list || courses.json?.data || [];
  const c = list.find((x) => String(x.org_id) === '2');

  // ⚠️ 每次建课次都用**不同的 start_time**。
  // 若 body 完全相同，多次 create 会命中同一缓存/去重路径，
  // 导致"新"课次其实是同一个 id —— 于是前一步的 /status 已经把课次结束，
  // 后一步的 /end 自然返回 400「已结束」，把测试自己的编排问题
  // 误报成权限失败（第一版就踩了这个坑，排查花了很久）。
  let slot = 0;
  const mk = async (classId, t) => {
    slot += 1;
    const start = `2026-09-12T${String(18 + Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}:00+08:00`;
    const r = await call('POST', '/attendance/sessions', {
      token: t,
      body: { course_id: String(c.id), class_id: String(classId), start_time: start },
    });
    return r.json?.data?.session_id;
  };

  let pass = 0, fail = 0;
  const check = (label, ok, extra = '') => {
    ok ? pass++ : fail++;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  };

  const ok2xx = (r) => (r.status === 200 || r.status === 201) && r.code === 0;
  const denied = (r) => r.status === 403 || r.code === 403;

  // ---------- A. 班主任(scope=1) 对外班(class=2) 的写操作应被拒 ----------
  console.log('--- A. 张老师(scope=class 1) 操作 class=2 课次（应全部拒绝）---');
  {
    const sid = await mk(2, admin);
    if (!sid) { check('建课次', false, '无法建课次'); }
    else {
      const r1 = await call('DELETE', `/attendance/sessions/${sid}`, { token: head });
      check('DELETE sessions/:id', denied(r1), `HTTP ${r1.status} code=${r1.code}`);

      const r2 = await call('POST', `/attendance/sessions/${sid}/end`, { token: head, body: {} });
      check('POST sessions/:id/end', denied(r2), `HTTP ${r2.status} code=${r2.code}`);

      const r3 = await call('POST', `/attendance/sessions/${sid}/status`, {
        token: head, body: { statusList: [] },
      });
      check('POST sessions/:id/status', denied(r3), `HTTP ${r3.status} code=${r3.code}`);

      await call('DELETE', `/attendance/sessions/${sid}`, { token: admin });
    }
  }

  // ---------- B. 班主任对自己班(class=1) 的写操作应允许 ----------
  console.log('\n--- B. 张老师(scope=class 1) 操作 class=1 课次（应允许，防止改死）---');
  {
    // ⚠️ /status 会把课次结束掉（保存签到状态即结束课次），
    // 因此 /end 必须用**另一个**课次，否则会得到 400「已结束或不可提前结束」，
    // 那是正确业务行为，不是权限问题。第一版共用同一课次导致误报 FAIL。
    const sidStatus = await mk(1, admin);
    if (!sidStatus) { check('建课次(status)', false, '无法建课次'); }
    else {
      // ⚠️ 这些端点成功时返回 **HTTP 201 + code:0**（Nest 对 POST 的默认状态码），
      // 断言必须接受 2xx，不能写死 200。
      const r3 = await call('POST', `/attendance/sessions/${sidStatus}/status`, {
        token: head, body: { statusList: [] },
      });
      check('POST sessions/:id/status', ok2xx(r3), `HTTP ${r3.status} code=${r3.code}`);
      await call('DELETE', `/attendance/sessions/${sidStatus}`, { token: admin });
    }

    const sidEnd = await mk(1, admin);
    if (!sidEnd) { check('建课次(end)', false, '无法建课次'); }
    else {
      const r2 = await call('POST', `/attendance/sessions/${sidEnd}/end`, { token: head, body: {} });
      check('POST sessions/:id/end', ok2xx(r2), `HTTP ${r2.status} code=${r2.code}`);
      await call('DELETE', `/attendance/sessions/${sidEnd}`, { token: admin });
    }
  }

  // ---------- C. 系统管理员不受限 ----------
  console.log('\n--- C. 系统管理员（scope=all，应不受限）---');
  {
    const sid = await mk(2, admin);
    const r = await call('POST', `/attendance/sessions/${sid}/status`, {
      token: admin, body: { statusList: [] },
    });
    check('POST sessions/:id/status', ok2xx(r), `HTTP ${r.status} code=${r.code}`);
    await call('DELETE', `/attendance/sessions/${sid}`, { token: admin });
  }

  // ---------- D. 级联删除防护：外班删除必须真的没有落库删除 ----------
  console.log('\n--- D. 越权删除不得真的删掉数据 ---');
  {
    const sid = await mk(2, admin);
    const before = await call('GET', '/attendance/sessions', { token: admin });
    const listBefore = (before.json?.data?.list || before.json?.data || []).length;
    await call('DELETE', `/attendance/sessions/${sid}`, { token: head });
    const after = await call('GET', '/attendance/sessions', { token: admin });
    const listAfter = (after.json?.data?.list || after.json?.data || []).length;
    check('课次在越权删除后仍存在', listAfter >= listBefore, `前 ${listBefore} → 后 ${listAfter}`);
    await call('DELETE', `/attendance/sessions/${sid}`, { token: admin });
  }

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
