/**
 * P1-2 验证脚本：静默时段真实生效（推迟而非丢弃）
 *
 * 验收点：
 *  1. 打扰型渠道（wechat）在静默期内被**推迟**（status 仍为 queued + schedule_at 指向静默结束），
 *     而不是发送、也不是丢弃；
 *  2. 非打扰型渠道（email）不受静默期限制；
 *  3. red / severe 等级强制突破静默期；
 *  4. 静默期外正常派发。
 *
 * 为了让测试不依赖真实时钟，这里通过改写 student_profiles.notify_prefs_json
 * 的方式把静默区间设为「覆盖当前时刻」，并在结束后还原。
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { NotificationDispatchService } from '../src/warning/notification-dispatch.service';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6380');

const redisStub: any = {
  get: (k: string) => redis.get(k),
  set: (k: string, v: string, ...rest: any[]) => (redis as any).set(k, v, ...rest),
  acquireLock: async () => true,
  releaseLock: async () => true,
  withLock: async (_k: string, _t: number, fn: any) => ({ locked: true, result: await fn() }),
};
const systemConfigStub: any = {
  getConfig: async () => ({}),
  getSectionConfig: async () => ({}),
};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = '') {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? '  ' + extra : ''}`);
}

/** 构造一个覆盖当前时刻的跨天静默区间 */
function quietRangeAroundNow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 小时前
  const end = new Date(now.getTime() + 3 * 60 * 60 * 1000);   // 3 小时后
  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
}

async function makeJob(opts: { channel: string; level: string; studentId: bigint }) {
  return prisma.notification_jobs.create({
    data: {
      trigger_type: 'rule',
      channel: opts.channel,
      template_code: null,
      receivers_json: [{ student_id: opts.studentId.toString(), name: '静默测试' }],
      params_json: { student_name: '静默测试', level: opts.level },
      status: 'queued',
    },
  });
}

async function main() {
  const svc = new NotificationDispatchService(prisma as any, redisStub, systemConfigStub);
  const student = await prisma.student_profiles.findFirst({ select: { id: true, notify_prefs_json: true } });
  if (!student) throw new Error('没有学生档案，无法测试');
  const originalPrefs: any = student.notify_prefs_json;

  const created: bigint[] = [];
  try {
    const range = quietRangeAroundNow();
    console.log(`静默区间设置为 ${range.start} - ${range.end}（覆盖当前时刻）`);
    await prisma.student_profiles.update({
      where: { id: student.id },
      data: { notify_prefs_json: { ...originalPrefs, quiet_hours: range } },
    });

    // --- 1) 打扰型渠道在静默期 → 推迟 ---
    const j1 = await makeJob({ channel: 'wechat', level: 'yellow', studentId: student.id });
    created.push(j1.id);
    await (svc as any).processSingleJob(j1);
    const a1 = await prisma.notification_jobs.findUnique({ where: { id: j1.id } });
    check(
      '打扰型渠道(wechat)在静默期被推迟且仍为 queued',
      a1?.status === 'queued' && a1?.schedule_at !== null,
      `status=${a1?.status} schedule_at=${a1?.schedule_at?.toISOString()} last_error=${a1?.last_error}`,
    );

    // --- 2) red 等级强制突破 ---
    const j2 = await makeJob({ channel: 'wechat', level: 'red', studentId: student.id });
    created.push(j2.id);
    await (svc as any).processSingleJob(j2);
    const a2 = await prisma.notification_jobs.findUnique({ where: { id: j2.id } });
    check(
      'red 等级强制突破静默期（未推迟）',
      a2?.status === 'deferred' && a2?.schedule_at === null,
      `status=${a2?.status} schedule_at=${a2?.schedule_at}`,
    );

    // --- 3) email 不受静默期限制 ---
    const j3 = await makeJob({ channel: 'email', level: 'yellow', studentId: student.id });
    created.push(j3.id);
    await (svc as any).processSingleJob(j3);
    const a3 = await prisma.notification_jobs.findUnique({ where: { id: j3.id } });
    check(
      'email 不受静默期限制（未推迟）',
      a3?.schedule_at === null,
      `status=${a3?.status} schedule_at=${a3?.schedule_at}`,
    );

    // --- 4) 静默期外正常派发 ---
    const outside = (() => {
      const now = new Date();
      const s = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      const e = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      const fmt = (d: Date) =>
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return { start: fmt(s), end: fmt(e) };
    })();
    await prisma.student_profiles.update({
      where: { id: student.id },
      data: { notify_prefs_json: { ...originalPrefs, quiet_hours: outside } },
    });

    const j4 = await makeJob({ channel: 'wechat', level: 'yellow', studentId: student.id });
    created.push(j4.id);
    await (svc as any).processSingleJob(j4);
    const a4 = await prisma.notification_jobs.findUnique({ where: { id: j4.id } });
    check(
      '静默期外正常派发（未推迟）',
      a4?.schedule_at === null && a4?.status === 'deferred',
      `status=${a4?.status} schedule_at=${a4?.schedule_at}`,
    );
  } finally {
    // 还原个人偏好并清理测试数据
    await prisma.student_profiles.update({
      where: { id: student.id },
      data: { notify_prefs_json: originalPrefs as any },
    });
    if (created.length) {
      await prisma.notification_logs.deleteMany({ where: { job_id: { in: created } } });
      await prisma.notification_jobs.deleteMany({ where: { id: { in: created } } });
    }
  }

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  await prisma.$disconnect();
  await redis.quit();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
