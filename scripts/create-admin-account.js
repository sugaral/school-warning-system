/**
 * 新增一个系统管理员账号
 *
 * 走 **POST /admin/users** 正式接口，而不是直接写库：
 *   - password_hash 由 shared/password.util.ts 统一哈希（@node-rs/bcrypt）
 *   - role / scope_type 经 loadRoleCatalog 校验（不会造出目录外的角色）
 *   - 账号唯一性、手机号占用检查、审计日志都由现有逻辑负责
 *
 * 目标账号：13800138010 / 管理员B / sys_admin(scope=system)
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const NEW_ACCOUNT = '13800138010';
const NEW_NAME = '管理员B';
const NEW_EMAIL = 'admin2@school.edu.cn';
const NEW_PASSWORD = 'Admin@2026';

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
  return { status: res.status, json, code: json?.code, msg: json?.message };
}

(async () => {
  // 1) 用现有超管登录
  const login = await call('POST', '/auth/login_admin', {
    body: { account: '13800138000', password: 'admin123' },
  });
  const token = login.json?.data?.token;
  if (!token) { console.log('❌ 超管登录失败:', JSON.stringify(login.json).slice(0, 200)); process.exit(1); }
  console.log('✅ 超管登录成功');

  // 2) 先探测是否已存在（避免重复创建）
  const probe = await call('POST', '/auth/login_admin', {
    body: { account: NEW_ACCOUNT, password: NEW_PASSWORD },
  });
  if (probe.json?.data?.token) {
    console.log(`ℹ️ 账号 ${NEW_ACCOUNT} 已存在且密码可用，无需重复创建`);
    process.exit(0);
  }

  // 3) 创建（若已存在则复用，保证脚本可重复执行）
  let userId = null;
  const create = await call('POST', '/admin/users', {
    token,
    body: {
      account: NEW_ACCOUNT,
      name: NEW_NAME,
      email: NEW_EMAIL,
      mobile: NEW_ACCOUNT,
      user_type: 'admin',
      role: 'sys_admin',
      scope_type: 'system',
      status: 'active',
    },
  });

  if (create.code === 0) {
    userId = create.json?.data?.id || create.json?.data?.user_id;
    console.log(`✅ 账号已创建 id=${userId}`);
  } else if (/已存在/.test(String(create.msg))) {
    // 重复执行时复用已有账号（例如上一次运行在"设置密码"步骤失败）。
    //
    // ⚠️ 不能用 GET /admin/users?keyword=... 查找：实测该端点**忽略 keyword**，
    //    返回的是分页后的全部用户（第一页全是学生），因此找不到目标账号。
    //    这里改为直接查库拿 id（只读，最可靠）。
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      'docker',
      ['exec', '-i', 'warnsys-mysql', 'sh', '-c',
       ["mysql -uroot -p" + (process.env.MYSQL_ROOT_PASSWORD || "") + " warnsys -N -B 2>/dev/null"].join("")],
      { input: `SELECT id FROM users WHERE mobile='${NEW_ACCOUNT}' LIMIT 1;\n`, encoding: 'utf8' },
    ).trim();
    const found = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).pop();
    if (!found) {
      console.log('❌ 账号已存在但未能定位其 id，请手动处理');
      process.exit(1);
    }
    userId = found;
    console.log(`ℹ️ 账号已存在，复用 id=${userId}`);
  } else {
    console.log('创建响应:', create.status, 'code=' + create.code, create.msg || '');
    console.log('完整响应:', JSON.stringify(create.json).slice(0, 400));
    process.exit(1);
  }

  // 4) 设置我们约定的密码
  //
  // ⚠️ PUT /admin/users/:id/password 的 body 字段名是 **newPassword**
  //    （见 users.controller.ts:1267 `@Body() body: { newPassword?: string }`）。
  //    第一版传了 `{ password }`，接口取不到值 → newPassword='' →
  //    isWeakPassword('') 返回 true → 报"密码过于简单"，
  //    看起来像密码不合规，实际是字段名传错。
  const setPwd = await call('PUT', `/admin/users/${userId}/password`, {
    token,
    body: { newPassword: NEW_PASSWORD },
  });
  console.log('设置密码:', setPwd.status, 'code=' + setPwd.code, setPwd.msg || '');
  if (setPwd.code !== 0) {
    console.log('   ❌ 设置密码失败，完整响应:', JSON.stringify(setPwd.json).slice(0, 300));
    process.exit(1);
  }

  // 5) 用新账号实际登录验证
  const verify = await call('POST', '/auth/login_admin', {
    body: { account: NEW_ACCOUNT, password: NEW_PASSWORD },
  });
  const ok = verify.json?.code === 0 && verify.json?.data?.token;
  console.log(`\n${ok ? '✅' : '❌'} 新账号登录验证: code=${verify.json?.code} ${verify.json?.message || ''}`);
  if (ok) {
    console.log('   角色:', JSON.stringify(verify.json.data.roles));
    console.log('   用户:', JSON.stringify(verify.json.data.user));

    // 6) 用新账号验证一下管理端权限确实生效
    const perms = await call('GET', '/admin/permissions', { token: verify.json.data.token });
    console.log(`   管理端 /admin/permissions: HTTP ${perms.status} code=${perms.code}`);
  }
  process.exit(ok ? 0 : 1);
})();
