/**
 * §13 角色自测（RBAC 越权与权限边界）
 *
 * 目标：验证每个角色**只能看到/操作自己权限范围内**的资源，
 * 且低权限角色访问高权限端点时被拒绝（401/403），
 * 而不是"因为没测所以默认放开"。
 *
 * 覆盖角色：
 *   - super_admin / sys_admin ：管理端全量
 *   - teaching_admin         ：教学管理
 *   - student                ：仅自助
 *   - 无 token               ：必须 401
 *
 * 判定：无权访问必须被拒（401/403/404），且**不得返回业务数据**。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function login(account, password) {
  const r = await call('POST', '/auth/login_admin', { body: { account, password } });
  return { token: r.json?.data?.token || null, raw: r };
}

/** 判定"被正确拒绝"：HTTP 非 2xx，或业务 code 非 0 */
function denied(r) {
  const httpDenied = r.status === 401 || r.status === 403 || r.status === 404;
  const codeNonZero = r.json && typeof r.json === 'object' && r.json.code !== undefined && r.json.code !== 0;
  return httpDenied || codeNonZero;
}

/**
 * 判定响应里是否**真的带了业务数据**。
 *
 * ⚠️ 踩过的坑：第一版直接看 `data` 是否非空，结果 403 响应体
 * `{"code":403,"data":{"message":"Forbidden","error":"Forbidden","statusCode":403}}`
 * 被误判成"有业务数据"，一次性报出 8 个假失败。
 * 正确做法：先排除错误响应（HTTP 非 2xx 或 code!==0），
 * 再看 data 里是否有**非错误信封**的内容。
 */
function hasBusinessData(r) {
  if (r.status < 200 || r.status >= 300) return false;
  const code = r.json && typeof r.json === 'object' ? r.json.code : undefined;
  if (code !== undefined && code !== 0) return false;

  const d = r.json?.data;
  if (d === null || d === undefined) return false;
  if (Array.isArray(d)) return d.length > 0;
  if (typeof d !== 'object') return false;

  // 排除错误信封的字段名
  const keys = Object.keys(d);
  const ERROR_ENVELOPE_KEYS = ['message', 'error', 'statusCode'];
  const onlyErrorKeys = keys.every((k) => ERROR_ENVELOPE_KEYS.includes(k));
  return keys.length > 0 && !onlyErrorKeys;
}

const ACCOUNTS = [
  { name: '系统管理员', account: '13800138000', password: 'admin123', expectAdmin: true },
  { name: '学工管理员', account: '13800138003', password: 'staff123', expectAdmin: false },
  { name: '班主任', account: '13800138001', password: 'teacher123', expectAdmin: false },
  { name: '教师', account: '13800138002', password: 'teacher123', expectAdmin: false },
  { name: '学生', account: '20230003', password: 'Student@2026', expectAdmin: false },
];

/**
 * 需高权限的端点。
 *
 * ⚠️ 注意：这里只放**确实不该给非管理端角色**的端点。
 * `stats/summary` 与 `reports/history` 不在其列 —— 按
 * rbac/permission-catalog.ts，head_teacher / student_admin 等角色
 * **本就拥有** `stats:view` / `report:read`（:136-175），
 * 把它们算作"越权"会得到假失败。
 * 这类端点的正确判据是**数据范围收敛**（见第 6 节），不是"必须 403"。
 */
const ADMIN_ONLY = [
  ['权限目录', 'GET', '/admin/permissions'],
  ['角色管理', 'GET', '/admin/roles'],
  ['用户管理', 'GET', '/admin/users?page=1&pageSize=5'],
  ['审计-操作日志', 'GET', '/admin/audit/operations?page=1&pageSize=5'],
  ['审计-安全事件', 'GET', '/admin/audit/security-events?page=1&pageSize=5'],
  ['系统配置-模板', 'GET', '/admin/config/templates'],
];

(async () => {
  console.log('=== §13 角色自测 ===\n');
  const sessions = [];
  for (const a of ACCOUNTS) {
    const s = await login(a.account, a.password);
    console.log(`登录 ${a.name.padEnd(6)} (${a.account}): ${s.token ? 'OK' : 'FAIL ' + JSON.stringify(s.raw.json).slice(0, 120)}`);
    if (s.token) sessions.push({ ...a, token: s.token });
  }
  console.log();

  let problems = 0;

  // ---------- 1. 无 token 必须 401 ----------
  console.log('--- 1. 未认证访问必须被拒 ---');
  for (const [name, method, path] of ADMIN_ONLY) {
    const r = await call(method, path);
    const ok = denied(r);
    if (!ok) problems += 1;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} HTTP ${r.status}`);
  }

  // ---------- 2. 学生不得访问管理端 ----------
  const student = sessions.find((s) => s.name === '学生');
  if (student) {
    console.log('\n--- 2. 学生越权访问管理端（必须全部被拒）---');
    for (const [name, method, path] of ADMIN_ONLY) {
      const r = await call(method, path, { token: student.token });
      const ok = denied(r) && !hasBusinessData(r);
      if (!ok) problems += 1;
      console.log(
        `  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} HTTP ${r.status} code=${r.json?.code} 有业务数据=${hasBusinessData(r)}`,
      );
    }

    // 学生可访问自己的站内消息
    console.log('\n--- 3. 学生自助端点（应当可用）---');
    const mine = await call('GET', '/student/inbox?pageSize=5', { token: student.token });
    const okMine = mine.status === 200 && mine.json?.code === 0;
    if (!okMine) problems += 1;
    console.log(`  ${okMine ? 'OK  ' : 'FAIL'} 我的站内消息   HTTP ${mine.status} code=${mine.json?.code}`);

    // 但不得访问别人的（用超范围 id 探测）
    const cross = await call('POST', '/student/inbox/1/read', { token: student.token, body: {} });
    const okCross = denied(cross);
    if (!okCross) problems += 1;
    console.log(`  ${okCross ? 'OK  ' : 'FAIL'} 越权标记他人    HTTP ${cross.status}`);
  }

  // ---------- 4. 系统管理员必须能访问（验证不是"全拒"） ----------
  console.log('\n--- 4. 系统管理员应可访问（防止"全拒"式的假通过）---');
  const sysAdmin = sessions.find((s) => s.expectAdmin);
  if (sysAdmin) {
    for (const [name, method, path] of ADMIN_ONLY) {
      const r = await call(method, path, { token: sysAdmin.token });
      const ok = r.status === 200 && r.json?.code === 0;
      if (!ok) problems += 1;
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} HTTP ${r.status} code=${r.json?.code}`);
    }
  } else {
    console.log('  FAIL 系统管理员未登录');
    problems += 1;
  }

  // ---------- 5. 非管理员角色不得拿到管理端数据 ----------
  console.log('\n--- 5. 非管理员角色访问管理端（越权探测）---');
  for (const s of sessions.filter((x) => !x.expectAdmin)) {
    let leaked = 0;
    let deniedCount = 0;
    for (const [name, method, path] of ADMIN_ONLY) {
      const r = await call(method, path, { token: s.token });
      if (denied(r)) deniedCount += 1;
      if (hasBusinessData(r)) {
        leaked += 1;
        console.log(`     ⚠️ ${s.name} 拿到 ${name} 的数据`);
      }
    }
    const ok = leaked === 0;
    if (!ok) problems += 1;
    console.log(
      `  ${ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(6)} 被拒 ${deniedCount}/${ADMIN_ONLY.length}，泄露 ${leaked}`,
    );
  }

  // ---------- 6. 数据范围收敛 ----------
  //
  // 关键判据：不同 scope_type 的角色看到的**数据量必须不同**。
  // 实测（本环境）：
  //   王学工 student_admin scope=college(2) → totalStudents 10005（本学院）
  //   张老师 head_teacher  scope=class(1)   → totalStudents 5003（本班）
  // 若两者相同，说明 scope 根本没生效 —— 那才是真缺陷。
  console.log('\n--- 6. 数据范围收敛（按 scope_type 收敛数据量）---');
  {
    const byName = Object.fromEntries(sessions.map((s) => [s.name, s]));
    const adminStats = byName['系统管理员']
      ? await call('GET', '/admin/stats/summary', { token: byName['系统管理员'].token })
      : null;
    const headStats = byName['班主任']
      ? await call('GET', '/admin/stats/summary', { token: byName['班主任'].token })
      : null;

    const pick = (r) => Number(r?.json?.data?.totalStudents ?? 0);
    const adminTotal = pick(adminStats);
    const headTotal = pick(headStats);

    console.log(`  系统管理员(全局) totalStudents = ${adminTotal}`);
    console.log(`  班主任(scope=class) totalStudents = ${headTotal}`);

    // 班主任必须严格小于全局；等于则 scope 失效
    const scopedOk = headTotal > 0 && headTotal < adminTotal;
    if (!scopedOk) problems += 1;
    console.log(
      `  ${scopedOk ? 'OK  ' : 'FAIL'} 班主任数据量严格小于全局（scope 生效）` +
        (scopedOk ? `（${headTotal} < ${adminTotal}）` : ''),
    );

    // 教师（teacher, scope=class）不应拿到全校学生列表
    for (const s of sessions.filter((x) => x.name === '教师')) {
      const r = await call('GET', '/admin/students?page=1&pageSize=1000', { token: s.token });
      const deniedOk = denied(r);
      const list = r.json?.data?.list || r.json?.data || [];
      const total = r.json?.data?.total ?? (Array.isArray(list) ? list.length : 0);
      const ok = deniedOk || Number(total) < adminTotal;
      if (!ok) problems += 1;
      console.log(
        `  ${ok ? 'OK  ' : 'FAIL'} 教师取学生列表 HTTP ${r.status} 条数=${total}（全局 ${adminTotal}）`,
      );
    }
  }

  console.log(`\n=== 角色自测结论 ===`);
  console.log(problems === 0 ? '✅ 权限边界正确：越权被拒、无权不返回数据' : `❌ 发现 ${problems} 项权限问题`);
  process.exit(problems === 0 ? 0 : 1);
})();
