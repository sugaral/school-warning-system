/**
 * 压测数据批量生成器（§11.5 前置）
 *
 * 目的：在**单机 Docker** 环境下做有意义的性能验收，需要先把数据量拉到
 * 接近真实规模（万人级）。逐条 Prisma 写入太慢，这里用原生 SQL 批量插入。
 *
 * 生成内容（可通过参数调整）：
 *  - students  ：默认 10,000 名学生（含 users + student_profiles + user_roles）
 *  - daily_records：每名学生默认 20 天记录（含 late/absent/homework/behavior）
 *  - warnings  ：默认 30,000 条预警（覆盖 4 等级 × 4 窗口 × 多指标）
 *  - notification_logs：默认 30,000 条（供通知送达报表压测）
 *
 * 用法:
 *   npx ts-node scripts/seed-load-test-data.ts --students=10000 --days=20 --warnings=30000
 *   npx ts-node scripts/seed-load-test-data.ts --clean     # 仅清理压测数据
 *
 * ⚠️ 清理仅删除 `@loadtest.local` 邮箱的压测账号及其关联数据，不影响种子/真实数据。
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
}
const WANT_CLEAN = process.argv.includes('--clean');
const STUDENTS = arg('students', 10000);
const DAYS = arg('days', 20);
const WARNINGS = arg('warnings', 30000);
const LOGS = arg('logs', 30000);
const LOADTEST_TAG = '@loadtest.local';

async function clean() {
  console.log('清理压测数据...');
  const users = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM users WHERE email LIKE ${'%' + LOADTEST_TAG}`;
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) {
    console.log('没有压测账号需要清理');
    return;
  }
  const profiles = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM student_profiles WHERE user_id IN (${Prisma.join(userIds)})`;
  const pids = profiles.map((p) => p.id);

  if (pids.length > 0) {
    await prisma.$executeRaw`DELETE FROM warning_current_states WHERE student_id IN (${Prisma.join(pids)})`;
    await prisma.$executeRaw`DELETE FROM warnings WHERE student_id IN (${Prisma.join(pids)})`;
    await prisma.$executeRaw`DELETE FROM daily_records WHERE student_id IN (${Prisma.join(pids)})`;
    await prisma.$executeRaw`DELETE FROM student_notification_reads WHERE student_id IN (${Prisma.join(pids)})`;
    await prisma.$executeRaw`DELETE FROM student_profiles WHERE id IN (${Prisma.join(pids)})`;
  }
  await prisma.$executeRaw`DELETE FROM user_roles WHERE user_id IN (${Prisma.join(userIds)})`;
  await prisma.$executeRaw`DELETE FROM users WHERE id IN (${Prisma.join(userIds)})`;
  console.log(`已清理 ${userIds.length} 个压测账号及其关联数据`);
}

async function main() {
  if (WANT_CLEAN) {
    await clean();
    await prisma.$disconnect();
    return;
  }

  // 幂等：先清理上一轮压测数据，避免重复插入触发唯一键冲突
  // （student_profiles.user_id / users.email 均有唯一约束）
  await clean();

  const started = Date.now();

  const classRows = await prisma.classes.findMany({ select: { id: true, org_id: true } });
  const courseRows = await prisma.courses.findMany({ select: { id: true } });
  if (classRows.length === 0 || courseRows.length === 0) {
    throw new Error('请先执行 prisma/seed.ts 建立班级与课程');
  }
  const classIds = classRows.map((c) => c.id);
  const orgByClass = new Map(classRows.map((c) => [c.id.toString(), c.org_id]));
  const courseIds = courseRows.map((c) => c.id);

  console.log(`开始生成压测数据：students=${STUDENTS} days=${DAYS} warnings=${WARNINGS} logs=${LOGS}`);

  // ---------- 1) users ----------
  const BATCH = 1000;
  const allUserIds: bigint[] = [];
  for (let start = 0; start < STUDENTS; start += BATCH) {
    const size = Math.min(BATCH, STUDENTS - start);
    const values: any[] = [];
    for (let i = 0; i < size; i++) {
      const n = start + i + 1;
      const cls = classIds[n % classIds.length];
      values.push(
        Prisma.sql`(${Number(cls)}, 'student', ${'压测学生' + n}, ${'139' + String(10000000 + n)}, ${'loadtest' + n + LOADTEST_TAG}, NULL, NULL, 'active', NOW(), NOW())`,
      );
    }
    await prisma.$executeRaw`
      INSERT INTO users (org_id, user_type, name, mobile, email, wx_openid, wx_unionid, status, created_at, updated_at)
      VALUES ${Prisma.join(values)}`;
  }
  const created = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM users WHERE email LIKE ${'%' + LOADTEST_TAG}`;
  allUserIds.push(...created.map((u) => u.id));
  console.log(`  users: ${allUserIds.length}（${Date.now() - started}ms）`);

  // ---------- 2) student_profiles ----------
  const profileIds: bigint[] = [];
  for (let start = 0; start < allUserIds.length; start += BATCH) {
    const slice = allUserIds.slice(start, start + BATCH);
    const values: any[] = [];
    slice.forEach((uid, idx) => {
      const n = start + idx + 1;
      const cls = classIds[n % classIds.length];
      const org = orgByClass.get(cls.toString())!;
      values.push(
        Prisma.sql`(${uid}, ${'LT' + String(100000 + n)}, ${Number(cls)}, ${Number(org)}, 'active', NOW(), NOW())`,
      );
    });
    await prisma.$executeRaw`
      INSERT INTO student_profiles (user_id, student_no, class_id, org_id, status, created_at, updated_at)
      VALUES ${Prisma.join(values)}`;
  }
  const profs = await prisma.$queryRaw<Array<{ id: bigint; class_id: bigint; org_id: bigint }>>`
    SELECT sp.id, sp.class_id, sp.org_id FROM student_profiles sp
    JOIN users u ON u.id = sp.user_id WHERE u.email LIKE ${'%' + LOADTEST_TAG}`;
  profs.forEach((p) => profileIds.push(p.id));
  console.log(`  student_profiles: ${profileIds.length}（${Date.now() - started}ms）`);

  // ---------- 3) user_roles ----------
  for (let start = 0; start < allUserIds.length; start += BATCH) {
    const slice = allUserIds.slice(start, start + BATCH);
    const values = slice.map(
      (uid) => Prisma.sql`(${uid}, 'student', 'self', NULL, NOW())`,
    );
    await prisma.$executeRaw`
      INSERT INTO user_roles (user_id, role, scope_type, scope_id, created_at)
      VALUES ${Prisma.join(values)}`;
  }
  console.log(`  user_roles: ${allUserIds.length}（${Date.now() - started}ms）`);

  // ---------- 4) daily_records ----------
  const attendance = ['on_time', 'on_time', 'on_time', 'late', 'absent', 'early_leave', 'leave'];
  const homework = ['submitted', 'submitted', 'not_submit', 'late_submit'];
  const behavior = ['normal', 'normal', 'normal', 'disruptive'];
  const today = new Date();
  const esc = (v: string) => `'${String(v).replace(/'/g, "''")}'`;
  let dailyTarget = 0;

  for (let start = 0; start < profs.length; start += BATCH) {
    const slice = profs.slice(start, start + BATCH);
    const rows: string[] = [];
    for (const p of slice) {
      const seed = Number(p.id) % 9973;
      for (let d = 0; d < DAYS; d++) {
        const day = new Date(today.getTime() - d * 86400000);
        const dateStr = day.toISOString().slice(0, 10);
        const courseId = courseIds[(seed + d) % courseIds.length];
        const att = attendance[(seed + d * 3) % attendance.length];
        const hw = homework[(seed + d * 5) % homework.length];
        const bh = behavior[(seed + d * 7) % behavior.length];
        rows.push(
          `(${p.id}, ${esc(dateStr)}, ${p.class_id}, ${p.org_id}, ${courseId}, ` +
            `${esc(att)}, ${esc(hw)}, ${esc(bh)}, NULL, 'auto', 'approved', NOW(), NOW())`,
        );
        dailyTarget++;
      }
    }
    // 按 2000 行切块执行，避免单条 SQL 过大
    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000);
      await prisma.$executeRawUnsafe(
        `INSERT IGNORE INTO daily_records
         (student_id, record_date, class_id, org_id, course_id, attendance_status,
          homework_status, class_behavior, remarks, source, approved_status, created_at, updated_at)
         VALUES ${chunk.join(',')}`,
      );
    }
  }
  const dailyCount = await prisma.daily_records.count();
  console.log(
    `  daily_records: 目标 ${dailyTarget}，表内实际 ${dailyCount}（${Date.now() - started}ms）`,
  );

  // ---------- 5) warnings ----------
  // warnings.rule_id 非空，必须引用真实规则
  const ruleRows = await prisma.warning_rules.findMany({ select: { id: true } });
  if (ruleRows.length === 0) {
    throw new Error('没有预警规则，无法生成 warnings（rule_id 非空）');
  }
  const ruleIds = ruleRows.map((r) => r.id);
  const levels = ['yellow', 'orange', 'red', 'severe'];
  const windows = ['day', 'week', 'month', 'term'];
  const metrics = ['late', 'absent', 'early_leave', 'homework_not_submit', 'class_behavior'];
  const statuses = ['open', 'open', 'acknowledged', 'closed', 'suppressed'];
  let warnTotal = 0;
  for (let start = 0; start < WARNINGS; start += BATCH) {
    const size = Math.min(BATCH, WARNINGS - start);
    const values: any[] = [];
    for (let i = 0; i < size; i++) {
      const n = start + i;
      const p = profs[n % profs.length];
      const level = levels[n % levels.length];
      const win = windows[n % windows.length];
      const metric = metrics[n % metrics.length];
      const status = statuses[n % statuses.length];
      const day = new Date(today.getTime() - (n % 180) * 86400000);
      const dateStr = day.toISOString().slice(0, 10);
      const courseId = courseIds[n % courseIds.length];
      const ruleId = ruleIds[n % ruleIds.length];
      const ack = status === 'acknowledged' || status === 'closed' ? 'NOW()' : 'NULL';
      values.push(
        `(${p.id}, ${p.class_id}, ${p.org_id}, '${metric}', '${level}', '${win}',
          '${dateStr}', '${dateStr}', ${ruleId}, '{"metric":"${metric}"}',
          '${metric} 达到阈值', '{"count":3}', ${courseId}, '${status}',
          ${ack}, NOW(), NOW())`,
      );
      warnTotal++;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO warnings
       (student_id, class_id, org_id, metric, level, \`window\`, period_start, period_end,
        rule_id, rule_snapshot_json, trigger_summary, trigger_detail_json, course_id, status,
        acknowledged_at, created_at, updated_at)
       VALUES ${values.join(',')}`,
    );
  }
  const warnCount = await prisma.warnings.count();
  console.log(`  warnings: 目标 ${warnTotal}，表内实际 ${warnCount}（${Date.now() - started}ms）`);

  // ---------- 6) notification_logs ----------
  const jobs = await prisma.notification_jobs.findMany({ select: { id: true }, take: 50 });
  if (jobs.length > 0) {
    const channels = ['email', 'wechat', 'sms'];
    const sendStatuses = ['success', 'success', 'failed', 'deferred'];
    for (let start = 0; start < LOGS; start += BATCH) {
      const size = Math.min(BATCH, LOGS - start);
      const values: any[] = [];
      for (let i = 0; i < size; i++) {
        const n = start + i;
        const job = jobs[n % jobs.length];
        values.push(
          `(${job.id}, '${channels[n % channels.length]}', 'loadtest${n}@example.com',
            '压测内容', '${sendStatuses[n % sendStatuses.length]}', 'smtp', NULL, NULL, NOW(), 0)`,
        );
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO notification_logs
         (job_id, channel, receiver, content_snapshot, send_status, provider,
          provider_msg_id, error_msg, sent_at, acknowledged)
         VALUES ${values.join(',')}`,
      );
    }
    console.log(`  notification_logs: ${LOGS}（${Date.now() - started}ms）`);
  } else {
    console.log('  跳过 notification_logs（没有 notification_jobs 记录）');
  }

  const elapsed = Date.now() - started;
  console.log(`\n===== 生成完成，总耗时 ${(elapsed / 1000).toFixed(1)}s =====`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
