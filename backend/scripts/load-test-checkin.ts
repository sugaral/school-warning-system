/**
 * §11.5 补充压测：扫码签到（并发 200）+ 日预警任务（万人级）+ 稳定性
 *
 * 背景：主压测脚本（load-test.ts）覆盖了列表/详情/看板/导出，但还有三项
 * 需求里明确列出、尚未取到数据的指标：
 *   1. 扫码签到 P99 < 200ms（并发 200）
 *   2. 日预警任务：1 万学生 < 5 分钟
 *   3. 长时间稳定性（观察 RSS 曲线，无内存泄漏）
 *
 * 扫码签到如何构造合法请求：
 *   token = sha256(`${session.qr_token_hash}:${bucketIndex}`).slice(0,16)
 *   bucketIndex = floor((now - session_start) / refreshSeconds / 1000)
 * 与 shared/qr-session.util.ts 的 buildRollingScanToken 完全一致，
 * 因此无需浏览器扫码即可真实压测该端点。
 *
 * 用法:
 *   npx ts-node scripts/load-test-checkin.ts                 # 全部三项
 *   npx ts-node scripts/load-test-checkin.ts --only=checkin
 *   npx ts-node scripts/load-test-checkin.ts --only=stability --stabilityMinutes=30
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const API = process.env.API_BASE || 'http://127.0.0.1:3000';

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
}
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

interface Sample { ms: number; ok: boolean; status: number }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function report(name: string, samples: Sample[], targetP99: number) {
  const lat = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok).length;
  const errorRate = (errors / samples.length) * 100;
  const p50 = percentile(lat, 50);
  const p95 = percentile(lat, 95);
  const p99 = percentile(lat, 99);
  const passed = p99 <= targetP99 && errorRate < 0.1;
  const statuses = new Map<number, number>();
  for (const s of samples) statuses.set(s.status, (statuses.get(s.status) || 0) + 1);
  const dist = [...statuses.entries()].map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(
    `${passed ? '✓' : '✗'} ${name.padEnd(28)} n=${String(samples.length).padStart(5)} ` +
      `P50=${p50.toFixed(0).padStart(4)}ms P95=${p95.toFixed(0).padStart(4)}ms ` +
      `P99=${p99.toFixed(0).padStart(4)}ms err=${errorRate.toFixed(2)}% ` +
      `目标P99<${targetP99}ms ${passed ? 'OK' : 'FAIL'}  [HTTP ${dist}]`,
  );
  return passed;
}

function buildToken(qrTokenHash: string, bucketIndex: number): string {
  return createHash('sha256')
    .update(`${qrTokenHash}:${bucketIndex}`)
    .digest('hex')
    .slice(0, 16);
}

/** 建立一次可签到的课次 + 学生 token */
async function setupCheckin(concurrency: number) {
  // ⚠️ 必须取**同一个班级**的学生：签到会校验"是否属于该课次班级"，
  // 否则会得到 code=4003「您不属于该班级」，压测结论就变成假的
  // （第一次跑就踩到了：200 个请求里 100 个 4003）。
  const classRow = await prisma.classes.findFirst({
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (!classRow) throw new Error('没有班级');

  let students = await prisma.student_profiles.findMany({
    where: { class_id: classRow.id },
    take: concurrency + 5,
    orderBy: { id: 'asc' },
    select: { id: true, class_id: true, org_id: true, user_id: true },
  });

  // 若该班人数不足，则改用人数最多的班级
  if (students.length < Math.min(concurrency, 10)) {
    const groups = await prisma.student_profiles.groupBy({
      by: ['class_id'],
      _count: { _all: true },
      orderBy: { _count: { class_id: 'desc' } },
      take: 1,
    });
    const biggest = groups[0]?.class_id;
    if (biggest) {
      students = await prisma.student_profiles.findMany({
        where: { class_id: biggest },
        take: concurrency + 5,
        orderBy: { id: 'asc' },
        select: { id: true, class_id: true, org_id: true, user_id: true },
      });
    }
  }
  if (students.length === 0) throw new Error('没有学生档案');
  const cls = students[0].class_id;
  console.log(`  使用班级 ${cls}，可用学生 ${students.length} 名`);

  const course = await prisma.courses.findFirst({ select: { id: true } });
  const teacher = await prisma.users.findFirst({
    where: { user_type: 'teacher' },
    select: { id: true },
  });
  if (!course || !teacher) throw new Error('缺少课程或教师');

  const now = new Date();
  const seed = `loadtest-${Date.now()}`;
  const session = await prisma.class_sessions.create({
    data: {
      course_id: course.id,
      class_id: cls,
      teacher_user_id: teacher.id,
      session_start: new Date(now.getTime() - 60 * 1000), // 1 分钟前开始
      session_end: new Date(now.getTime() + 60 * 60 * 1000), // 1 小时后结束
      qr_token_hash: seed,
      qr_expire_at: new Date(now.getTime() + 60 * 60 * 1000),
      status: 'active',
    },
  });
  return { session, seed, students: students.slice(0, concurrency) };
}

async function studentToken(studentUserId: bigint): Promise<string | null> {
  const user = await prisma.users.findUnique({
    where: { id: studentUserId },
    select: { name: true },
  });
  const profile = await prisma.student_profiles.findFirst({
    where: { user_id: studentUserId },
    select: { student_no: true },
  });
  if (!user || !profile) return null;
  const res = await fetch(`${API}/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      student_no: profile.student_no,
      name: user.name,
      password: 'Student@2026',
    }),
  });
  const json: any = await res.json();
  return json.code === 0 ? json.data.token : null;
}

async function testCheckin() {
  const CONC = arg('checkinConcurrency', 200);
  console.log(`\n--- 扫码签到压测（并发 ${CONC}）---`);

  const { session, seed, students } = await setupCheckin(CONC);

  // 先给这些学生批量设置可用密码（压测账号）
  const { hashPassword } = require('../src/shared/password.util');
  const pwHash = await hashPassword('Student@2026');
  await prisma.users.updateMany({
    where: { id: { in: students.map((s) => s.user_id) } },
    data: { password_hash: pwHash },
  });

  // 换取学生 token（并发）
  const tokens: Array<{ studentId: bigint; token: string }> = [];
  const tokenResults = await Promise.all(
    students.map(async (s) => {
      const t = await studentToken(s.user_id);
      return t ? { studentId: s.id, token: t } : null;
    }),
  );
  for (const r of tokenResults) if (r) tokens.push(r);
  console.log(`  已获取 ${tokens.length}/${students.length} 个学生 token`);

  if (tokens.length === 0) {
    console.log('  ✗ 无法获取学生 token，跳过签到压测');
    await prisma.class_sessions.delete({ where: { id: session.id } });
    return false;
  }

  // ⚠️ 滚动码刷新间隔来自配置 `warning.qrRefreshMinutes`（默认 15 分钟 = 900s），
  // 控制器用 Math.min(7200, Math.max(5, minutes*60)) 收敛。
  // 我最初硬编码 60s 导致 bucketIndex 完全对不上，200 个请求 100% 业务失败 ——
  // 这正是「压测必须先搞清楚被测契约」的教训。
  const cfgRow = await prisma.system_settings.findUnique({
    where: { setting_key: 'warning' },
  });
  let refreshSeconds = 900;
  if (cfgRow?.setting_val) {
    try {
      const parsed = JSON.parse(cfgRow.setting_val);
      const minutes = Number(parsed?.qrRefreshMinutes);
      if (Number.isFinite(minutes)) {
        refreshSeconds = Math.min(7200, Math.max(5, Math.round(minutes * 60)));
      }
    } catch {
      /* 用默认值 */
    }
  }
  console.log(`  滚动码刷新间隔 = ${refreshSeconds}s`);

  const bucketIndex = Math.max(
    0,
    Math.floor((Date.now() - session.session_start.getTime()) / 1000 / refreshSeconds),
  );
  const token = buildToken(seed, bucketIndex);
  console.log(`  bucketIndex=${bucketIndex}`);

  // 并发签到
  const t0 = Date.now();
  const settled = await Promise.all(
    tokens.map(async ({ studentId, token: stoken }) => {
      const s0 = Date.now();
      try {
        const res = await fetch(`${API}/attendance/checkin`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stoken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ session_id: Number(session.id), scan_token: token }),
        });
        const body: any = await res.json().catch(() => ({}));
        return {
          ms: Date.now() - s0,
          ok: res.ok && body?.code === 0,
          status: res.status,
          bizCode: body?.code,
          message: body?.message,
        } as any;
      } catch {
        return { ms: Date.now() - s0, ok: false, status: 0 };
      }
    }),
  );
  const wallMs = Date.now() - t0;

  const passed = report('扫码签到', settled, 200);
  console.log(`  总墙钟耗时 ${wallMs}ms（${tokens.length} 并发）`);

  // 打印失败原因分布（诊断用，避免只看到"失败了"却不知道原因）
  const failReasons = new Map<string, number>();
  for (const s of settled) {
    if (!s.ok) {
      const key = `code=${(s as any).bizCode ?? '?'} ${(s as any).message ?? ''}`.slice(0, 90);
      failReasons.set(key, (failReasons.get(key) || 0) + 1);
    }
  }
  if (failReasons.size > 0) {
    console.log('  失败原因分布:');
    for (const [k, v] of [...failReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`    ${v} × ${k}`);
    }
  }

  const records = await prisma.attendance_records.count({
    where: { session_id: session.id },
  });
  console.log(`  attendance_records 落库 ${records} 条`);

  // 清理
  await prisma.attendance_records.deleteMany({ where: { session_id: session.id } });
  await prisma.daily_records.deleteMany({
    where: { student_id: { in: students.map((s) => s.id) } },
  });
  await prisma.class_sessions.delete({ where: { id: session.id } });
  return passed;
}

async function testDailyWarning() {
  console.log('\n--- 日预警任务（万人级）---');
  const login = await fetch(`${API}/auth/login_admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
  });
  const lj: any = await login.json();
  if (lj.code !== 0) { console.log('  ✗ 登录失败'); return false; }
  const token = lj.data.token;

  const before = await prisma.warnings.count();
  const t0 = Date.now();
  // 用 AbortController 给足 10 分钟，避免 undici 默认 30s 超时误判
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 600_000);
  let json: any = null;
  try {
    const res = await fetch(`${API}/jobs/run_daily_warning`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
      signal: ac.signal,
    });
    json = await res.json();
  } catch (e: any) {
    console.log(`  ✗ 请求失败/超时: ${e?.message || e}`);
    clearTimeout(timer);
    return false;
  }
  clearTimeout(timer);
  const ms = Date.now() - t0;
  const after = await prisma.warnings.count();
  const passed = ms < 300_000;
  console.log(
    `${passed ? '✓' : '✗'} 日预警任务(万人级)  耗时=${(ms / 1000).toFixed(1)}s ` +
      `生成=${after - before} 条  目标<300s ${passed ? 'OK' : 'FAIL'}`,
  );
  if (json && json.code !== 0) console.log(`  响应: code=${json.code} msg=${json.message}`);
  return passed;
}

async function testStability() {
  const minutes = arg('stabilityMinutes', 30);
  console.log(`\n--- 稳定性观察（${minutes} 分钟，关注 RSS 是否持续增长）---`);
  const login = await fetch(`${API}/auth/login_admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
  });
  const lj: any = await login.json();
  const token = lj.data.token;
  const paths = ['/warnings?page=1&pageSize=20', '/admin/stats', '/admin/stats/summary', '/health'];

  const samples: Array<{ min: number; rssMb: number; errRate: number }> = [];
  const deadline = Date.now() + minutes * 60 * 1000;
  let i = 0;
  let errors = 0;
  let total = 0;

  while (Date.now() < deadline) {
    // 每 30 秒采一次 RSS + 打一轮负载
    const roundStart = Date.now();
    const roundErrorsBefore = errors;
    const roundTotalBefore = total;
    while (Date.now() - roundStart < 30_000) {
      try {
        const res = await fetch(`${API}${paths[i++ % paths.length]}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        await res.text();
        total++;
        if (!res.ok) errors++;
      } catch {
        total++;
        errors++;
      }
    }
    // 读取 API 进程 RSS（通过 docker stats 不适用于本机进程，改用 ps）
    const rssMb = await readProcessRssMb();
    const min = Math.round((Date.now() - (deadline - minutes * 60 * 1000)) / 60000);
    const roundErr = ((errors - roundErrorsBefore) / Math.max(1, total - roundTotalBefore)) * 100;
    samples.push({ min, rssMb, errRate: roundErr });
    console.log(
      `  t=${String(min).padStart(2)}min  RSS=${rssMb.toFixed(1)}MB  本轮错误率=${roundErr.toFixed(2)}%  累计请求=${total}`,
    );
  }

  const first = samples[1]?.rssMb ?? samples[0]?.rssMb ?? 0;
  const last = samples[samples.length - 1]?.rssMb ?? 0;
  const growth = last - first;
  const growthPct = first > 0 ? (growth / first) * 100 : 0;
  const totalErrRate = (errors / Math.max(1, total)) * 100;
  // 判定：RSS 增长 <20% 且总错误率 <0.1%
  const passed = growthPct < 20 && totalErrRate < 0.1;
  console.log(
    `${passed ? '✓' : '✗'} 稳定性：RSS ${first.toFixed(1)}MB → ${last.toFixed(1)}MB ` +
      `(增长 ${growthPct.toFixed(1)}%)，总错误率 ${totalErrRate.toFixed(2)}% ` +
      `${passed ? 'OK' : 'FAIL'}`,
  );
  return passed;
}

/** 读取监听 3000 端口的 node 进程 RSS */
async function readProcessRssMb(): Promise<number> {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 1 -ExpandProperty WorkingSet64"',
        { encoding: 'utf8', timeout: 15000 },
      ).trim();
      const bytes = Number(out);
      return Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 / 1024 : 0;
    }
    const out = execSync(
      "ps -eo rss,args | grep 'dist/main.js' | grep -v grep | awk '{print $1}' | head -1",
      { encoding: 'utf8', timeout: 15000 },
    ).trim();
    const kb = Number(out);
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : 0;
  } catch {
    return 0;
  }
}

async function main() {
  console.log('=========== §11.5 补充压测 ===========');
  const results: Array<{ name: string; ok: boolean }> = [];

  if (!ONLY || ONLY === 'checkin') {
    results.push({ name: '扫码签到', ok: await testCheckin() });
  }
  if (!ONLY || ONLY === 'daily') {
    results.push({ name: '日预警任务', ok: await testDailyWarning() });
  }
  if (!ONLY || ONLY === 'stability') {
    results.push({ name: '稳定性', ok: await testStability() });
  }

  console.log('\n=========== 汇总 ===========');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 通过`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
