const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testDatabase() {
  try {
    console.log('开始测试数据库连接...');

    // 测试连接
    await prisma.$connect();
    console.log('✓ 数据库连接成功');

    // 检查班级数据
    const classes = await prisma.classes.findMany();
    console.log(`✓ 找到 ${classes.length} 个班级`);
    if (classes.length > 0) {
      console.log('班级列表:', classes.map(c => ({ id: c.id, name: c.class_name })));
    }

    // 检查预警数据
    const warnings = await prisma.warnings.findMany();
    console.log(`✓ 找到 ${warnings.length} 条预警记录`);
    if (warnings.length > 0) {
      console.log('预警记录:', warnings.map(w => ({ id: w.id, class_id: w.class_id, status: w.status })));
    }

    // 检查用户数据
    const users = await prisma.users.findMany();
    console.log(`✓ 找到 ${users.length} 个用户`);

    // 检查学生档案
    const students = await prisma.student_profiles.findMany();
    console.log(`✓ 找到 ${students.length} 个学生档案`);

    console.log('数据库测试完成');
  } catch (error) {
    console.error('数据库测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();
