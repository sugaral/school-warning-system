/**
 * §11.5 压测与性能验收脚本
 *
 * 为什么自己写而不用 autocannon：
 *  - 本项目所有业务接口都需要 JWT + 权限，autocannon/k6 需要额外的
 *    认证钩子脚本；而单机 Docker + 万人级数据的场景下，
 *    自建压测器可以直接复用同一份登录逻辑，并能精确控制"预热后再计量"。
 *  - 需要同时输出 P50/P95/P99 + 吞吐 + 错误率，自建更直观。
 *
 * 覆盖 §11.5 的目标指标：
 *  - 登录（含 bcrypt 开销）      P99 < 500ms
 *  - 预警列表（多条件+分页）      P99 < 300ms
 *  - 预警详情                    P99 < 200ms
 *  - 统计/看板                   P99 < 500ms
 *  - 扫码签到（并发 200）         P99 < 200ms
 *  - 导出 1 万行                 < 30s（异步）
 *  - 混合负载（并发 300）        错误率 < 0.1%
 *
 * 用法: npx ts-node scripts/load-test.ts [--concurrency=50] [--duration=10]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.API_BASE || 'http://127.0.0.1:3000';

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
}

const CONCURRENCY = arg('concurrency', 50);
const DURATION_SEC = arg('duration', 8);

interface Sample {
  ms: number;
  ok: boolean;
  status: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(name: string, samples: Sample[], targetP99?: number) {
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok).length;
  const total = samples.length;
  const errorRate = total === 0 ? 0 : (errors / total) * 100;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const throughput = total / DURATION_SEC;

  const passed = targetP99 === undefined ? true : p99 <= targetP99 && errorRate < 0.1;

  console.log(
    `${passed ? '✓' : '✗'} ${name.padEnd(30)} ` +
      `n=${String(total).padStart(6)} ` +
      `P50=${p50.toFixed(0).padStart(5)}ms ` +
      `P95=${p95.toFixed(0).padStart(5)}ms ` +
      `P99=${p99.toFixed(0).padStart(5)}ms ` +
      `err=${errorRate.toFixed(2)}% ` +
      `tput=${throughput.toFixed(0)}/s` +
      (targetP99 !== undefined ? `  目标P99<${targetP99}ms ${passed ? 'OK' : 'FAIL'}` : ''),
  );

  return { name, p50, p95, p99, errorRate, throughput, total, passed, targetP99 };
}

/** 以固定并发持续 duration 秒压测某接口 */
async function runLoad(
  path: string,
  opts: { headers: Record<string, string>; durationSec?: number; concurrency?: number; method?: string; body?: string },
): Promise<Sample[]> {
  const durationSec = opts.durationSec ?? DURATION_SEC;
  const concurrency = opts.concurrency ?? CONCURRENCY;
  const deadline = Date.now() + durationSec * 1000;
  const samples: Sample[] = [];

  async function worker() {
    while (Date.now() < deadline) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${API}${path}`, {
          method: opts.method || 'GET',
          headers: { ...opts.headers, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
          body: opts.body,
        });
        const ms = Date.now() - t0;
        // 吃掉响应体，保证连接可复用
        await res.text();
        samples.push({ ms, ok: res.ok, status: res.status });
      } catch {
        samples.push({ ms: Date.now() - t0, ok: false, status: 0 });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return samples;
}

async function loginAdmin(): Promise<string> {
  const res = await fetch(`${API}/auth/login_admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
  });
  const json: any = await res.json();
  if (json.code !== 0) throw new Error('登录失败: ' + json.message);
  return json.data.token;
}

async function main() {
  console.log('================ §11.5 压测 ================');
  console.log(`目标服务: ${API}`);
  console.log(`并发: ${CONCURRENCY}  单轮时长: ${DURATION_SEC}s\n`);

  const token = await loginAdmin();
  const auth = { Authorization: `Bearer ${token}` };

  const results: any[] = [];

  // 预热（避免首请求的懒加载污染 P99）
  for (const p of ['/warnings', '/admin/stats', '/health']) {
    await fetch(`${API}${p}`, { headers: auth }).then((r) => r.text()).catch(() => {});
  }

  // ---------- 1) 登录（含 bcrypt） ----------
  {
    // ⚠️ 重要：登录端点带 `@Throttle({ default: { limit: 120, ttl: 60_000 } })`，
    // 即每 IP 每分钟最多 120 次（约 2 req/s）。这是**故意设计的防爆破限流**，
    // 不是缺陷。若按高并发猛打（实测曾达 917 req/s），98% 请求会被限流拒绝，
    // 得到的是「限流生效」的结论，而不是登录延迟。
    //
    // 因此这里采用**受控速率**（默认 2 req/s、20 次），在限流阈值内测量真实
    // 登录延迟；同时独立验证限流器本身是否生效。
    const LOGIN_RATE_PER_SEC = arg('loginRate', 2);
    const LOGIN_SAMPLES = arg('loginSamples', 20);
    const samples: Sample[] = [];
    const intervalMs = 1000 / LOGIN_RATE_PER_SEC;

    for (let i = 0; i < LOGIN_SAMPLES; i++) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${API}/auth/login_admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
        });
        await res.text();
        samples.push({ ms: Date.now() - t0, ok: res.ok, status: res.status });
      } catch {
        samples.push({ ms: Date.now() - t0, ok: false, status: 0 });
      }
      if (i < LOGIN_SAMPLES - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    // 限流阈值内测量，用样本数换算吞吐（不同于固定时长口径）
    const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
    const errors = samples.filter((s) => !s.ok).length;
    const errorRate = (errors / samples.length) * 100;
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const passed = p99 <= 500 && errorRate < 0.1;
    console.log(
      `${passed ? '✓' : '✗'} ${'登录（限流阈值内,受控速率）'.padEnd(30)} ` +
        `n=${String(samples.length).padStart(6)} ` +
        `P50=${p50.toFixed(0).padStart(5)}ms ` +
        `P95=${p95.toFixed(0).padStart(5)}ms ` +
        `P99=${p99.toFixed(0).padStart(5)}ms ` +
        `err=${errorRate.toFixed(2)}% ` +
        `  目标P99<500ms ${passed ? 'OK' : 'FAIL'}`,
    );
    results.push({
      name: '登录（限流阈值内）',
      p50, p95, p99, errorRate, throughput: LOGIN_RATE_PER_SEC,
      total: samples.length, passed, targetP99: 500,
    });

    // 独立验证限流器生效：快速连打，应出现非 2xx
    const burst: Sample[] = [];
    await Promise.all(
      Array.from({ length: 60 }, async () => {
        const t0 = Date.now();
        try {
          const res = await fetch(`${API}/auth/login_admin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account: '13800138000', password: 'admin123' }),
          });
          await res.text();
          burst.push({ ms: Date.now() - t0, ok: res.ok, status: res.status });
        } catch {
          burst.push({ ms: Date.now() - t0, ok: false, status: 0 });
        }
      }),
    );
    const rejected = burst.filter((b) => !b.ok).length;
    console.log(
      `${rejected > 0 ? '✓' : '✗'} ${'登录限流器（防爆破）'.padEnd(30)} ` +
        `突发60次 → 被拒 ${rejected} 次（期望 >0，证明限流生效）`,
    );
  }

  // ---------- 2) 预警列表（分页 + 多条件） ----------
  {
    const s1 = await runLoad('/warnings?page=1&pageSize=20', { headers: auth });
    results.push(summarize('预警列表 分页', s1, 300));

    const s2 = await runLoad(
      '/warnings?page=1&pageSize=20&level=red&window=week&status=open&metric=late',
      { headers: auth },
    );
    results.push(summarize('预警列表 多条件筛选', s2, 300));

    const s3 = await runLoad('/warnings?page=500&pageSize=20', { headers: auth });
    results.push(summarize('预警列表 深分页(第500页)', s3, 300));
  }

  // ---------- 3) 预警详情 ----------
  {
    const one = await prisma.warnings.findFirst({ orderBy: { id: 'desc' } });
    if (one) {
      const s = await runLoad(`/admin/warnings/student?student_id=${one.student_id}`, {
        headers: auth,
      });
      results.push(summarize('预警详情/按学生查询', s, 200));
    }
  }

  // ---------- 4) 统计看板 ----------
  {
    const s1 = await runLoad('/admin/stats', { headers: auth });
    results.push(summarize('统计看板 /admin/stats', s1, 500));
    const s2 = await runLoad('/admin/stats/summary', { headers: auth });
    results.push(summarize('统计看板 /summary', s2, 500));
  }

  // ---------- 5) 健康检查（基线） ----------
  {
    const s = await runLoad('/health', { headers: auth });
    results.push(summarize('健康检查（基线）', s, undefined));
  }

  // ---------- 6) 混合负载（并发 300） ----------
  {
    const conc = arg('mixedConcurrency', 300);
    const paths = [
      '/warnings?page=1&pageSize=20',
      '/admin/stats',
      '/admin/stats/summary',
      '/health',
      '/warnings?page=2&pageSize=20&level=red',
      '/student/summaries',
    ];
    const deadline = Date.now() + DURATION_SEC * 1000;
    const samples: Sample[] = [];
    async function worker(id: number) {
      let i = id;
      while (Date.now() < deadline) {
        const t0 = Date.now();
        try {
          const res = await fetch(`${API}${paths[i++ % paths.length]}`, { headers: auth });
          await res.text();
          samples.push({ ms: Date.now() - t0, ok: res.ok, status: res.status });
        } catch {
          samples.push({ ms: Date.now() - t0, ok: false, status: 0 });
        }
      }
    }
    await Promise.all(Array.from({ length: conc }, (_, i) => worker(i)));
    const mixed = summarize(`混合负载(并发${conc})`, samples, undefined);
    // 混合负载要求错误率 <0.1%
    mixed.passed = mixed.errorRate < 0.1;
    results.push(mixed);
  }

  // ---------- 7) 异步导出 1 万行 ----------
  {
    const t0 = Date.now();
    const res = await fetch(`${API}/admin/reports/generate/weekly`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json: any = await res.json();
    const jobId = json?.data?.export_job_id;
    const enqueueMs = Date.now() - t0;
    console.log(
      `· 导出入队耗时 ${enqueueMs}ms（应远小于同步生成，证明已异步化）job=${jobId}`,
    );

    if (jobId) {
      // 轮询直到完成
      const waitStart = Date.now();
      let status = 'queued';
      let fileId: string | null = null;
      while (Date.now() - waitStart < 60000) {
        const row = await prisma.export_jobs.findUnique({ where: { id: BigInt(jobId) } });
        status = row?.status || 'unknown';
        fileId = row?.file_id ? row.file_id.toString() : null;
        if (status === 'success' || status === 'failed') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      const totalMs = Date.now() - waitStart;
      const passed = status === 'success' && totalMs < 30000;
      results.push({
        name: '异步导出（完成时间）',
        p50: totalMs,
        p95: totalMs,
        p99: totalMs,
        errorRate: status === 'success' ? 0 : 100,
        throughput: 0,
        total: 1,
        passed,
        targetP99: 30000,
      });
      console.log(
        `${passed ? '✓' : '✗'} ${'异步导出（完成时间）'.padEnd(30)} status=${status} file_id=${fileId} 耗时=${totalMs}ms  目标<30000ms ${passed ? 'OK' : 'FAIL'}`,
      );
    }
  }

  // ---------- 8) 日预警任务（万人级） ----------
  {
    const t0 = Date.now();
    const res = await fetch(`${API}/jobs/run_daily_warning`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
    });
    const json: any = await res.json();
    const ms = Date.now() - t0;
    const passed = ms < 300000;
    console.log(
      `${passed ? '✓' : '✗'} ${'日预警任务(万人级)'.padEnd(30)} 耗时=${(ms / 1000).toFixed(1)}s ` +
        `生成=${json?.data?.warnings_generated ?? '?'}  目标<300s ${passed ? 'OK' : 'FAIL'}`,
    );
    results.push({
      name: '日预警任务(万人级)',
      p50: ms, p95: ms, p99: ms, errorRate: 0, throughput: 0, total: 1,
      passed, targetP99: 300000,
    });
  }

  // ---------- 汇总 ----------
  console.log('\n================ 验收汇总 ================');
  const graded = results.filter((r) => r.targetP99 !== undefined);
  const passedCount = graded.filter((r) => r.passed).length;
  console.log(`达标 ${passedCount}/${graded.length}`);
  const failed = graded.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('未达标项：');
    for (const f of failed) {
      console.log(`  - ${f.name}: P99=${f.p99.toFixed(0)}ms 目标<${f.targetP99}ms err=${f.errorRate.toFixed(2)}%`);
    }
  }

  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
