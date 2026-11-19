import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MISSING_PERMISSIONS = [
  { code: 'student:preference', name: '修改偏好', description: '修改个人偏好设置', resource: 'student', action: 'preference' },
  { code: 'teacher:read', name: '查看教师', description: '查看教师信息', resource: 'teacher', action: 'read' },
  { code: 'teacher:create', name: '创建教师', description: '创建新教师', resource: 'teacher', action: 'create' },
  { code: 'teacher:update', name: '更新教师', description: '更新教师信息', resource: 'teacher', action: 'update' },
  { code: 'teacher:delete', name: '删除教师', description: '删除教师', resource: 'teacher', action: 'delete' },
];

async function main() {
  console.log('开始检查并修复缺失的权限...');

  for (const perm of MISSING_PERMISSIONS) {
    const existing = await prisma.permissions.findUnique({
      where: { code: perm.code },
    });

    if (!existing) {
      await prisma.permissions.create({
        data: perm,
      });
      console.log(`✅ 已创建权限: ${perm.code}`);
    } else {
      console.log(`✅ 权限已存在: ${perm.code}`);
    }
  }

  const allPerms = await prisma.permissions.findMany();
  console.log('\n当前所有权限数量:', allPerms.length);
  console.log('✅ 权限修复完成！');
}

main()
  .catch(e => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
