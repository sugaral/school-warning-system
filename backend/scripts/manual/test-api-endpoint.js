const http = require('http');

// 首先，让我们通过Prism直接测试数据库查询，然后测试API
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testDatabase() {
  console.log('=== 数据库直接查询测试 ===');
  const session = await prisma.class_sessions.findFirst({
    orderBy: { created_at: 'desc' }
  });
  
  if (session) {
    console.log('找到课次:', { id: session.id.toString(), class_id: session.class_id.toString() });
    
    const students = await prisma.student_profiles.findMany({
      where: { class_id: session.class_id },
      include: { users: true },
    });
    
    console.log('直接查询到的学生数量:', students.length);
    console.log('前5个学生:', students.slice(0, 5).map(s => ({
      id: s.id.toString(),
      name: s.users?.name,
      class_id: s.class_id.toString()
    })));
  }
  await prisma.$disconnect();
}

testDatabase().catch(console.error);
