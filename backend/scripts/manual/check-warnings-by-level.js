const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://warnuser:warnpass123@127.0.0.1:3307/warnsys?authPlugins=mysql_native_password&charset=utf8mb4&connectionLimit=10'
    }
  }
});

async function main() {
  console.log('正在检查各级别预警数据...\n');
  
  const levels = ['yellow', 'orange', 'red', 'severe'];
  const levelNames = {
    yellow: '黄色预警',
    orange: '橙色预警',
    red: '红色预警',
    severe: '严重预警'
  };
  
  for (const level of levels) {
    const count = await prisma.warnings.count({
      where: { level }
    });
    console.log(`${levelNames[level]} (${level}): ${count} 条`);
  }
  
  console.log('\n最近10条预警：');
  const recentWarnings = await prisma.warnings.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: {
      id: true,
      level: true,
      trigger_summary: true,
      created_at: true
    }
  });
  
  recentWarnings.forEach(w => {
    console.log(`ID: ${w.id}, 级别: ${w.level}, 摘要: ${w.trigger_summary}, 时间: ${w.created_at}`);
  });
  
  await prisma.$disconnect();
}

main().catch(console.error);
