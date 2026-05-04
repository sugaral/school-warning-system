const { PrismaClient } = require('@prisma/client');
const { createHash, randomBytes } = require('crypto');
const prisma = new PrismaClient();

async function test() {
  try {
    console.log('=== 创建测试课次 ===');
    
    // 获取第一个班级
    const classInfo = await prisma.classes.findFirst();
    if (!classInfo) {
      console.log('没有找到班级');
      return;
    }
    console.log('使用班级:', { id: classInfo.id.toString(), name: classInfo.class_name });
    
    // 获取第一个课程
    const courseInfo = await prisma.courses.findFirst();
    if (!courseInfo) {
      console.log('没有找到课程');
      return;
    }
    console.log('使用课程:', { id: courseInfo.id.toString(), name: courseInfo.course_name });
    
    // 创建课次
    const start = new Date();
    const expireAt = new Date(start.getTime() + 30 * 60 * 1000);
    
    const salt = randomBytes(8).toString('hex');
    const qrTokenHash = createHash('sha256')
      .update(classInfo.id.toString() + ':' + courseInfo.id.toString() + ':' + start.toISOString() + ':' + salt)
      .digest('hex');
    
    const session = await prisma.class_sessions.create({
      data: {
        course_id: courseInfo.id,
        class_id: classInfo.id,
        teacher_user_id: BigInt(1),
        session_start: start,
        qr_token_hash: qrTokenHash,
        qr_expire_at: expireAt,
        status: 'active',
      },
    });
    
    console.log('创建课次成功:', { id: session.id.toString() });
    
    // 测试获取应签到名单
    console.log('\n=== 测试获取应签到名单 ===');
    const students = await prisma.student_profiles.findMany({
      where: { class_id: session.class_id },
      include: { users: true },
    });
    
    console.log('应签到学生数量:', students.length);
    console.log('学生列表:', students.map(s => ({
      id: s.id.toString(),
      name: s.users?.name,
      class_id: s.class_id.toString(),
      status: s.status
    })));
    
  } catch (error) {
    console.error('错误:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test();
