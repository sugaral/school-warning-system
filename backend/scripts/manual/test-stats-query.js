const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://warnuser:warnpass123@127.0.0.1:3307/warnsys?authPlugins=mysql_native_password&charset=utf8mb4&connectionLimit=10'
    }
  }
});

async function main() {
  console.log('正在模拟统计接口的查询...');
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const warningsWhere = {
    created_at: {
      gte: thirtyDaysAgo
    }
  };
  
  console.log('查询条件:', warningsWhere);
  
  const levelDistribution = await prisma.warnings.groupBy({
    by: ['level', 'status'],
    where: warningsWhere,
    _count: {
      id: true
    }
  });
  
  console.log('\n原始groupBy结果:');
  console.log(levelDistribution);
  
  let yellowCount = 0;
  let orangeCount = 0;
  let redCount = 0;
  let severeCount = 0;

  levelDistribution.forEach(item => {
    const count = item._count.id;
    console.log(`\n处理: level=${item.level}, status=${item.status}, count=${count}`);
    
    if (item.level === 'yellow' || item.level === 'low') {
      yellowCount += count;
      console.log('  -> 加到黄色');
    } else if (item.level === 'orange') {
      orangeCount += count;
      console.log('  -> 加到橙色');
    } else if (item.level === 'red' || item.level === 'high') {
      redCount += count;
      console.log('  -> 加到红色');
    } else if (item.level === 'severe' || item.level === 'critical') {
      severeCount += count;
      console.log('  -> 加到严重');
    }
  });
  
  console.log('\n最终统计:');
  console.log('  黄色:', yellowCount);
  console.log('  橙色:', orangeCount);
  console.log('  红色:', redCount);
  console.log('  严重:', severeCount);
  
  await prisma.$disconnect();
}

main().catch(console.error);
