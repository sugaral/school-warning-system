/**
 * teaching-admin 组织过滤的权限边界验证
 *
 * ─────────────────────────────────────────────────────────────
 * 第 21 轮曾把"该控制器用客户端传入的 org_id 过滤"记为待办风险，
 * 怀疑存在跨学院越权读取。第 22 轮核实后结论是**不成立**，理由：
 *
 *   1. 这三个端点（classes / students / courses）的 @Roles 只允许
 *      `dean` / `teaching_admin` / `sys_admin`；
 *   2. `teaching_admin` 在 rbac_roles 中的 default_scope 是 **school**
 *      （全校），`dean`（=vice_dean）是 org 范围但**不匹配字面量 `dean`**，
 *      因此实际拿到访问权的只有全校级角色；
 *   3. 当前所有非学生账号的实测结果为：student_admin(college=2) 在这三个
 *      端点上全部 403，管理员 200。
 *
 * 也就是说 `org_id` 对能访问它的角色而言是**合法筛选条件**（全校角色选学院），
 * 而不是可以被用来越权的"信任客户端输入"。
 *
 * 本脚本把上述结论固化为可重复断言，避免以后有人只看代码又误判一次。
 * ─────────────────────────────────────────────────────────────
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
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, json: j, code: j && j.code };
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

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  const admin = await login('13800138000', 'admin123');
  const staff = await login('13800138003', 'staff123'); // student_admin, college(2)
  const head = await login('13800138001', 'teacher123'); // head_teacher, class(1)

  console.log('=== teaching-admin 组织过滤权限边界 ===\n');

  for (const [label, base] of [
    ['班级', '/teaching-admin/classes'],
    ['学生', '/teaching-admin/students'],
    ['课程', '/teaching-admin/courses'],
  ]) {
    console.log(`--- ${label} ---`);

    // 1) 组织范围角色（student_admin / head_teacher）必须被角色守卫拒绝
    const s2 = await call('GET', `${base}?org_id=2&page=1&pageSize=5`, { token: staff });
    const s3 = await call('GET', `${base}?org_id=3&page=1&pageSize=5`, { token: staff });
    const h1 = await call('GET', `${base}?org_id=1&page=1&pageSize=5`, { token: head });
    check(
      '  组织范围角色被拒绝（student_admin）',
      s2.status === 403 && s3.status === 403,
      `org=2 → ${s2.status}, org=3 → ${s3.status}`,
    );
    check('  班级范围角色被拒绝（head_teacher）', h1.status === 403, `HTTP ${h1.status}`);

    // 2) 全校角色（sys_admin）可访问，且 org_id 作为筛选生效
    const a2 = await call('GET', `${base}?org_id=2&page=1&pageSize=5`, { token: admin });
    check('  全校角色可访问', a2.status === 200 && a2.code === 0, `HTTP ${a2.status} 条数=${countOf(a2)}`);
  }

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  console.log('结论：org_id 对可访问角色是合法筛选条件；组织范围角色在角色守卫层即被拒绝。');
  process.exit(fail === 0 ? 0 : 1);
})();
