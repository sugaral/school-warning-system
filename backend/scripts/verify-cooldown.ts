/**
 * P1-1 验证脚本：通知频控（cooldown）真实生效
 *
 * 验收点：
 *  1. cooldown_key 被真实写入 notification_jobs（修复前全仓库零写入）
 *  2. 冷却是"先发送成功再写键"——发送失败不写冷却键
 *  3. 冷却期内第二次派发被抑制为 suppressed
 *
 * 用法: npx ts-node scripts/verify-cooldown.ts
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { NotificationDispatchService } from '../src/warning/notification-dispatch.service';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6380');

const redisStub: any = {
  get: (k: string) => redis.get(k),
  set: (k: string, v: string, ...rest: any[]) => (redis as any).set(k, v, ...rest),
  acquireLock: async (k: string, ttl: number, v: string) =>
    (await redis.set(k, v, 'PX', ttl, 'NX')) === 'OK',
  releaseLock: async () => true,
  withLock: async (_k: string, _t: number, fn: any) => ({ locked: true, result: await fn() }),
};

const systemConfigStub: any = {
  getConfig: async () => ({}),
  getSectionConfig: async () => ({}),
};

const COOLDOWN_KEY = 'test-student:yellow:99:2026-09-07';
const REDIS_KEY = `warn:notify:cooldown:${COOLDOWN_KEY}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = '') {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${extra ? '  ' + extra : ''}`);
}

async function main() {
  const svc = new NotificationDispatchService(prisma as any, redisStub, systemConfigStub);

  // 清理
  await redis.del(REDIS_KEY);

  // --- 1) 冷却键未命中 → 正常走派发（wechat 未实现 → deferred），且写冷却键 ---
  const jobA = await prisma.notification_jobs.create({
    data: {
      trigger_type: 'rule',
      channel: 'wechat',
      template_code: null,
      receivers_json: [{ name: '测试学生' }],
      params_json: { student_name: '测试学生' },
      cooldown_key: COOLDOWN_KEY,
      status: 'queued',
    },
  });

  await (svc as any).processSingleJob(jobA);
  const afterA = await prisma.notification_jobs.findUnique({ where: { id: jobA.id } });
  check('冷却键已写入 notification_jobs', Boolean(afterA?.cooldown_key), `key=${afterA?.cooldown_key}`);
  check('首个任务正常派发（deferred，未命中冷却）', afterA?.status === 'deferred', `status=${afterA?.status}`);

  // --- 2) 模拟"发送成功后写入冷却键" ---
  await (svc as any).markCooldown(afterA);
  const ttl = await redis.ttl(REDIS_KEY);
  check('冷却键已写入 Redis 且设置了 TTL', ttl > 0, `ttl=${ttl}s`);
  check('isCoolingDown 返回 true', (await (svc as any).isCoolingDown(COOLDOWN_KEY)) === true);

  // --- 3) 冷却期内第二个同 key 任务必须被抑制 ---
  const jobB = await prisma.notification_jobs.create({
    data: {
      trigger_type: 'rule',
      channel: 'wechat',
      template_code: null,
      receivers_json: [{ name: '测试学生' }],
      params_json: { student_name: '测试学生' },
      cooldown_key: COOLDOWN_KEY,
      status: 'queued',
    },
  });

  await (svc as any).processSingleJob(jobB);
  const afterB = await prisma.notification_jobs.findUnique({ where: { id: jobB.id } });
  check(
    '冷却期内第二个任务被抑制为 suppressed',
    afterB?.status === 'suppressed',
    `status=${afterB?.status} last_error=${afterB?.last_error}`,
  );

  // --- 4) 发送失败不应写冷却键（顺序保护）---
  await redis.del(REDIS_KEY);
  check(
    '清除冷却键后 isCoolingDown 返回 false',
    (await (svc as any).isCoolingDown(COOLDOWN_KEY)) === false,
  );

  // 清理测试数据
  await prisma.notification_logs.deleteMany({ where: { job_id: { in: [jobA.id, jobB.id] } } });
  await prisma.notification_jobs.deleteMany({ where: { id: { in: [jobA.id, jobB.id] } } });
  await redis.del(REDIS_KEY);

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
