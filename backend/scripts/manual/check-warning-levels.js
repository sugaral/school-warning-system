const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://warnuser:warnpass123@127.0.0.1:3307/warnsys?authPlugins=mysql_native_password&charset=utf8mb4&connectionLimit=10'
    }
  }
});

async function main() {
  console.log('正在检查预警数据...');
  
  const warnings = await prisma.warnings.findMany({
    select: {
      id: true,
      level: true,
      created_at: true
    },
    take: 20,
    orderBy: {
      created_at: 'desc'
    }
  });
  
  console.log('\n最新20条预警数据的级别:');
  warnings.forEach(w => {
    console.log(`ID: ${w.id}, 级别: ${w.level}, 创建时间: ${w.created_at}`);
  });
  
  // 统计各级别数量
  const levelStats = await prisma.warnings.groupBy({
    by: ['level'],
    _count: {
      id: true
    }
  });
  
  console.log('\n各级别统计:');
  levelStats.forEach(s => {
    console.log(`级别: ${s.level}, 数量: ${s._count.id}`);
  });
  
  await prisma.$disconnect();
}

main().catch(console.error);
