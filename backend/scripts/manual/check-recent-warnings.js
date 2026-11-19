const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://warnuser:warnpass123@127.0.0.1:3307/warnsys?authPlugins=mysql_native_password&charset=utf8mb4&connectionLimit=10'
    }
  }
});

async function main() {
  console.log('正在检查最近30天内的预警数据...');
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const levelDistribution = await prisma.warnings.groupBy({
    by: ['level'],
    where: {
      created_at: {
        gte: thirtyDaysAgo
      }
    },
    _count: {
      id: true
    }
  });
  
  console.log('\n最近30天内各级别统计:');
  levelDistribution.forEach(s => {
    console.log(`级别: ${s.level}, 数量: ${s._count.id}`);
  });
  
  await prisma.$disconnect();
}

main().catch(console.error);
