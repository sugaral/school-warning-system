const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEndedSessions() {
  try {
    console.log('=== 检查已结束但未处理的签到 ===');
    
    const now = new Date();
    console.log('当前时间:', now.toISOString());
    
    const endedSessions = await prisma.class_sessions.findMany({
      where: {
        qr_expire_at: { lt: now },
        status: 'active',
      },
      include: {
        classes: {
          include: {
            student_profiles: true,
          },
        },
        courses: true,
      },
    });

    console.log(`找到 ${endedSessions.length} 个已结束但未处理的签到`);
    
    for (const session of endedSessions) {
      console.log(`\n签到ID: ${session.id}`);
      console.log(`课程: ${session.courses?.course_name || 'N/A'}`);
      console.log(`班级: ${session.classes?.class_name || 'N/A'}`);
      console.log(`签到开始: ${session.session_start?.toISOString() || 'N/A'}`);
      console.log(`二维码过期: ${session.qr_expire_at?.toISOString() || 'N/A'}`);
      console.log(`状态: ${session.status}`);
      console.log(`学生数量: ${session.classes?.student_profiles?.length || 0}`);
    }

    if (endedSessions.length === 0) {
      console.log('\n没有找到需要处理的签到');
    }

  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkEndedSessions();
