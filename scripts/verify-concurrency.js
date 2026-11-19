/**
 * §13 并发自测
 *
 * 目标：验证系统在多用户同时读写时不会出现
 *   - 状态码错乱（5xx / 超时）
 *   - 数据竞争导致的重复写入（幂等失效）
 *   - 连接池耗尽
 *
 * 覆盖场景：
 *   A. 并发只读（20 并发 × 多个只读接口）—— 基线吞吐
 *   B. 并发导出创建（10 并发）—— 验证 enqueue 不互斥、不生重复
 *   C. 并发站内消息读 + 标记已读（同一用户 10 并发）—— 验证 CAS 不报错
 *   D. 并发登录（20 并发）—— 验证 bcrypt 不阻塞事件循环
 *
 * 判定：无 5xx、无超时、P95 在合理范围、无重复副作用。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const ROUNDS = Number(process.env.ROUNDS || 5);

async function call(method, path, { token, body } = {}) {
  const t0 = Date.now();
  try {
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
    return { status: res.status, json, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: null, ms: Date.now() - t0, error: e.cause?.code || e.message };
  }
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/**
 * 插入一条「未读」站内消息作为并发探针，返回其 id。
 *
 * 为什么走数据库而不是 API：站内消息由系统在预警/公告时写入，
 * 没有"任意创建消息"的用户接口（也不该有 —— 否则就是伪造通知）。
 * 因此验证脚本直接经 docker exec 落一条探针数据。
 */
function seedUnreadProbe(userId) {
  const { execFileSync } = require('child_process');
  const sql =
    `INSERT INTO notification (user_id, type, content, status, created_at, updated_at) ` +
    `VALUES (${Number(userId)}, 'system', '[并发自测探针] 请忽略', 'unread', NOW(), NOW()); ` +
    `SELECT LAST_INSERT_ID();`;
  const out = execFileSync(
    'docker',
    [
      'exec', 'warnsys-mysql', 'sh', '-c',
      `mysql -uroot -p${process.env.MYSQL_ROOT_PASSWORD || ''} --default-character-set=utf8mb4 warnsys -N -B -e "${sql}" 2>/dev/null`,
    ],
    { encoding: 'utf8' },
  ).trim();
  const id = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).pop();
  return id || null;
}

function report(name, results) {
  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const s5xx = results.filter((r) => r.status >= 500).length;
  const timeouts = results.filter((r) => r.status === 0).length;
  const ms = results.map((r) => r.ms);
  console.log(
    `${name}\n` +
      `   请求 ${results.length} | 2xx ${ok} | 5xx ${s5xx} | 失败/超时 ${timeouts}\n` +
      `   P50 ${pct(ms, 50)}ms  P95 ${pct(ms, 95)}ms  P99 ${pct(ms, 99)}ms  max ${Math.max(...ms)}ms`,
  );
  return { ok, s5xx, timeouts, p95: pct(ms, 95) };
}

(async () => {
  const login = await call('POST', '/auth/login_admin', {
    body: { account: '13800138000', password: 'admin123' },
  });
  const token = login.json?.data?.token;
  if (!token) { console.log('登录失败'); process.exit(1); }
  console.log(`登录 OK（${login.ms}ms）\n并发=${CONCURRENCY} 轮数=${ROUNDS}\n`);

  let failures = 0;

  // ---------- A. 并发只读 ----------
  {
    const paths = [
      '/admin/permissions',
      '/warning-rules',
      '/admin/roles',
      '/admin/classes?page=1&pageSize=10',
      '/admin/stats/summary',
    ];
    const results = [];
    for (let r = 0; r < ROUNDS; r += 1) {
      const batch = Array.from({ length: CONCURRENCY }, (_, i) =>
        call('GET', paths[i % paths.length], { token }),
      );
      results.push(...(await Promise.all(batch)));
    }
    const s = report('A. 并发只读（混合 5 个接口）', results);
    failures += s.s5xx + s.timeouts;
  }

  // ---------- B. 并发导出创建（验证幂等/不互斥） ----------
  {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('POST', '/admin/reports/generate/daily', { token })),
    );
    const s = report('B. 并发创建导出任务（10 并发）', results);
    failures += s.s5xx + s.timeouts;
    const ids = results.map((r) => r.json?.data?.export_job_id).filter(Boolean);
    const uniq = new Set(ids);
    console.log(`   生成 job 数=${ids.length} 去重后=${uniq.size} → ${ids.length === uniq.size ? '✅ 无重复 ID' : '❌ 有重复'}`);
    if (ids.length !== uniq.size) failures += 1;
  }

  // ---------- C. 并发站内消息读 + 标记已读 ----------
  {
    const sres = await call('POST', '/auth/login_admin', {
      body: { account: '20230003', password: 'Student@2026' },
    });
    const st = sres.json?.data?.token;
    if (!st) {
      console.log('C. 跳过（学生登录失败）');
    } else {
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => call('GET', '/student/inbox?pageSize=10', { token: st })),
      );
      const s = report('C1. 并发读站内消息', results);
      failures += s.s5xx + s.timeouts;

      // 并发标记同一条已读。
      //
      // 前提：该消息必须先是「未读」，否则 10 次调用都会返回 404
      // （已读再标记 = 没有真实状态迁移），test 就失去意义。
      // 因此这里先插一条全新的未读消息，保证起点确定。
      const probeUserId = sres.json?.data?.user?.id;
      let probeId = null;
      if (probeUserId) {
        const ins = await seedUnreadProbe(probeUserId);
        probeId = ins;
      }

      if (probeId) {
        const marks = await Promise.all(
          Array.from({ length: 10 }, () =>
            call('POST', `/student/inbox/${probeId}/read`, { token: st, body: {} }),
          ),
        );
        const s2 = report(`C2. 并发标记同一条(${probeId})已读`, marks);
        const okCount = marks.filter((m) => m.status >= 200 && m.status < 300).length;
        const notFound = marks.filter((m) => m.status === 404).length;
        // 正确语义：恰好 1 次真正完成 unread→read，其余 9 次幂等返回 404
        const idempotent = okCount === 1 && notFound === 9;
        if (!idempotent) failures += 1;
        console.log(
          `   成功 ${okCount} / 404 ${notFound} → ` +
            (idempotent
              ? '✅ 恰好一次状态迁移，其余幂等'
              : `❌ 期望 1 成功 + 9 个 404`),
        );
        failures += s2.s5xx + s2.timeouts;
      } else {
        console.log('C2. 跳过（未能准备未读探针消息）');
      }
    }
  }

  // ---------- D. 并发登录（bcrypt 事件循环阻塞回归） ----------
  {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        call('POST', '/auth/login_admin', {
          body: { account: '13800138000', password: 'admin123' },
        }),
      ),
    );
    const s = report('D. 并发登录（bcrypt 性能回归）', results);
    failures += s.s5xx + s.timeouts;
    // 历史故障：bcryptjs 阻塞事件循环，P99 达 2929ms
    console.log(`   ${s.p95 < 1000 ? '✅' : '⚠️'} P95=${s.p95}ms（历史故障值 P99 2929ms）`);
  }

  console.log(`\n=== 并发自测结论 ===`);
  console.log(failures === 0 ? '✅ 无 5xx / 无超时 / 无重复副作用' : `❌ 发现 ${failures} 项异常`);
  process.exit(failures === 0 ? 0 : 1);
})();
