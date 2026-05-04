const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    console.log('=== 检查班级列表 ===');
    const classes = await prisma.classes.findMany({ take: 5 });
    console.log('班级列表:', classes.map(c => ({ id: c.id.toString(), name: c.class_name, org_id: c.org_id.toString() })));
    
    if (classes.length > 0) {
      const classId = classes[0].id;
      console.log(`\n=== 检查班级 ${classId} 的学生 ===`);
      const students = await prisma.student_profiles.findMany({
        where: { class_id: classId },
        include: { users: true },
        take: 10
      });
      console.log(`学生数量: ${students.length}`);
      console.log('学生列表:', students.map(s => ({
        id: s.id.toString(),
        student_no: s.student_no,
        name: s.users?.name,
        class_id: s.class_id.toString(),
        status: s.status
      })));
      
      console.log(`\n=== 检查班级 ${classId} 的课次 ===`);
      const sessions = await prisma.class_sessions.findMany({
        where: { class_id: classId },
        take: 5
      });
      console.log('课次数量:', sessions.length);
      if (sessions.length > 0) {
        const sessionId = sessions[0].id;
        console.log(`\n=== 检查课次 ${sessionId} 的应签到名单 ===`);
        const sessionStudents = await prisma.student_profiles.findMany({
          where: { class_id: sessions[0].class_id },
          include: { users: true }
        });
        console.log('应签到学生数量:', sessionStudents.length);
        console.log('学生:', sessionStudents.map(s => ({
          id: s.id.toString(),
          name: s.users?.name,
          status: s.status
        })));
      }
    }
    
  } catch (error) {
    console.error('错误:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
