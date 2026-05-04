
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Warning System Data Fix ---');

  // 1. Ensure Organization 2 exists
  const org = await prisma.orgs.upsert({
    where: { id: 2n },
    update: {},
    create: {
      id: 2n,
      name: '演示学院/机构',
    }
  });
  console.log('✅ Organization 2 checked/created');

  // 2. Ensure Class 1 exists
  const cls = await prisma.classes.upsert({
    where: { id: 1n },
    update: { org_id: 2n },
    create: {
      id: 1n,
      class_name: '演示班级',
      org_id: 2n,
      major: '演示专业',
      grade: '2024',
    }
  });
  console.log('✅ Class 1 checked/created');

  // 3. Ensure Student 1 exists (linked to User 5)
  const student = await prisma.student_profiles.upsert({
    where: { id: 1n },
    update: { class_id: 1n, org_id: 2n },
    create: {
      id: 1n,
      user_id: 5n,
      student_no: 'FIXED_001',
      class_id: 1n,
      org_id: 2n,
      status: 'active',
    }
  });
  console.log('✅ Student 1 checked/created');

  // 4. Ensure Warning Rule 7 exists (optional but good for consistency)
  await prisma.warning_rules.upsert({
    where: { id: 7n },
    update: {},
    create: {
      id: 7n,
      metric: 'absent',
      level: 'red',
      window: 'month',
      threshold: 1,
      enabled: true,
      scope: 'school',
    }
  });
  console.log('✅ Warning Rule 7 checked/created');

  // 5. Fix the existing Warning record status
  const updateResult = await prisma.warnings.updateMany({
    where: {
      OR: [
        { id: 1n },
        { student_id: 1n, status: 'active' }
      ]
    },
    data: {
      status: 'open', // 这是核心修正：改为 open 才能在默认列表显示
      class_id: 1n,
      org_id: 2n,
      rule_id: 7n,
    }
  });

  if (updateResult.count > 0) {
    console.log(`✅ Successfully updated ${updateResult.count} warning records to "open" status.`);
  } else {
    console.log('ℹ️ No records found to update (they might already be correct or not exist).');
  }

  console.log('\n--- Fix Complete ---');
  console.log('请现在刷新管理端控制台，列表应该会显示出来了。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
