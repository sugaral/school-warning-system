import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('开始检查并修复权限数据...');

  const statsPermission = await prisma.permissions.findUnique({
    where: { code: 'stats:view' },
  });

  if (!statsPermission) {
    console.log('❌ stats:view 权限不存在，正在创建...');
    await prisma.permissions.create({
      data: {
        code: 'stats:view',
        name: '查看统计',
        description: '查看系统统计数据',
        resource: 'stats',
        action: 'view',
      },
    });
    console.log('✅ stats:view 权限已创建');
  } else {
    console.log('✅ stats:view 权限已存在');
  }

  const roles = ['sys_admin', 'student_admin', 'teaching_admin', 'vice_dean', 'head_teacher'];
  const perm = await prisma.permissions.findUnique({ where: { code: 'stats:view' } });

  if (perm) {
    for (const role of roles) {
      const existing = await prisma.role_permissions.findFirst({
        where: {
          role,
          permission_id: perm.id,
        },
      });

      if (!existing) {
        await prisma.role_permissions.create({
          data: {
            role,
            permission_id: perm.id,
          },
        });
        console.log(`✅ 已为角色 ${role} 添加 stats:view 权限`);
      } else {
        console.log(`✅ 角色 ${role} 已有 stats:view 权限`);
      }
    }
  }

  console.log('✅ 权限修复完成！');

  const allPerms = await prisma.permissions.findMany();
  console.log('\n当前所有权限:');
  allPerms.forEach(p => console.log(`  - ${p.code}: ${p.name}`));
}

main()
  .catch(e => {
    console.error('❌ 错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
