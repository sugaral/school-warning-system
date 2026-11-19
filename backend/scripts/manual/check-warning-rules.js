const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://warnuser:warnpass123@127.0.0.1:3307/warnsys?authPlugins=mysql_native_password&charset=utf8mb4&connectionLimit=10'
    }
  }
});

async function main() {
  console.log('正在查看预警规则...');
  
  const rules = await prisma.warning_rules.findMany({
    orderBy: { id: 'asc' }
  });
  
  console.log(`\n找到 ${rules.length} 条预警规则：\n`);
  
  rules.forEach(rule => {
    console.log(`ID: ${rule.id}`);
    console.log(`指标: ${rule.metric}`);
    console.log(`窗口: ${rule.window}`);
    console.log(`阈值: ${rule.threshold}`);
    console.log(`级别: ${rule.level}`);
    console.log(`启用: ${rule.enabled ? '是' : '否'}`);
    console.log('---');
  });
  
  await prisma.$disconnect();
}

main().catch(console.error);
