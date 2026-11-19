/**
 * P0-2 验证脚本：未配置/未实现的渠道不得记为「发送成功」
 *
 * 修复前行为：wechat/sms/wecom/app 渠道会写
 *   notification_logs.send_status='success', provider='deferred'
 *   且 notification_jobs.status='completed'
 * 修复后行为：
 *   notification_logs.send_status='deferred' + error_msg 归因
 *   notification_jobs.status='deferred'
 *
 * 用法: npx ts-node scripts/verify-notification-channel.ts
 */
import { PrismaClient } from '@prisma/client';
import { NotificationDispatchService } from '../src/warning/notification-dispatch.service';

const prisma = new PrismaClient();

// 仅测试 deferUnsupportedChannel 的行为，故用最小桩替代 Nest 依赖
const redisStub: any = {};
const systemConfigStub: any = {
  getConfig: async () => ({}),
  getSectionConfig: async () => ({}), // 未配置任何渠道
};

async function main() {
  const service = new NotificationDispatchService(prisma as any, redisStub, systemConfigStub);

  const channels = ['wechat', 'wecom', 'app', 'sms', 'email'];
  let failures = 0;

  for (const channel of channels) {
    const job = await prisma.notification_jobs.create({
      data: {
        trigger_type: 'rule',
        channel,
        template_code: null,
        receivers_json: [{ name: '测试学生', mobile: '13900000000', openid: 'o_test' }],
        params_json: { student_name: '测试学生' },
        status: 'queued',
      },
    });

    // 直接调用私有方法以隔离渠道分支（email 分支需真实 SMTP，单独处理）
    await (service as any).deferUnsupportedChannel(job, '测试内容', channel);

    const after = await prisma.notification_jobs.findUnique({ where: { id: job.id } });
    const logs = await prisma.notification_logs.findMany({ where: { job_id: job.id } });

    const log = logs[0];
    const isFalseSuccess = logs.some((l) => l.send_status === 'success');
    const jobCompleted = after?.status === 'completed';

    console.log(`\n--- channel=${channel} ---`);
    console.log(`  job.status      = ${after?.status}`);
    console.log(`  job.last_error  = ${after?.last_error}`);
    console.log(`  log.send_status = ${log?.send_status}`);
    console.log(`  log.provider    = ${log?.provider}`);
    console.log(`  log.error_msg   = ${log?.error_msg}`);
    console.log(`  log count       = ${logs.length}`);

    const ok = !isFalseSuccess && !jobCompleted && log?.send_status === 'deferred';
    console.log(`  ${ok ? 'PASS' : 'FAIL'} 未记为成功且状态为 deferred`);

    if (!ok) failures++;

    await prisma.notification_logs.deleteMany({ where: { job_id: job.id } });
    await prisma.notification_jobs.delete({ where: { id: job.id } });
  }

  console.log(`\n===== ${channels.length - failures}/${channels.length} 渠道通过 =====`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
