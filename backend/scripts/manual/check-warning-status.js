const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkWarningStatus() {
  console.log('正在检查各级别预警的状态...\n');

  const levels = ['yellow', 'orange', 'red', 'severe'];
  const statuses = ['open', 'acknowledged'];

  for (const level of levels) {
    console.log(`\n=== ${level} 级预警 ===`);
    for (const status of statuses) {
      const count = await prisma.warnings.count({
        where: {
          level,
          status
        }
      });
      console.log(`  ${status}: ${count} 条`);
    }
  }

  console.log('\n=== 最近5条红色预警 ===');
  const redWarnings = await prisma.warnings.findMany({
    where: { level: 'red' },
    orderBy: { created_at: 'desc' },
    take: 5,
    select: {
      id: true,
      level: true,
      status: true,
      trigger_summary: true,
      created_at: true
    }
  });

  redWarnings.forEach(w => {
    console.log(`ID: ${w.id}, 级别: ${w.level}, 状态: ${w.status}, 摘要: ${w.trigger_summary}, 时间: ${w.created_at}`);
  });

  await prisma.$disconnect();
}

checkWarningStatus().catch(console.error);
