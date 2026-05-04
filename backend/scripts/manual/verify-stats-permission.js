const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyStatsPermission() {
  console.log('========== 验证 stats:view 权限 ==========\n');

  try {
    // 1. 检查 stats:view 权限是否存在
    const statsPermission = await prisma.permissions.findFirst({
      where: { code: 'stats:view' },
    });
    console.log(`1. stats:view 权限存在吗? ${statsPermission ? '✅ 是' : '❌ 否'}`);
    if (statsPermission) {
      console.log(`   权限名称: ${statsPermission.name}`);
      console.log(`   权限描述: ${statsPermission.description}`);
    }

    // 2. 检查 sys_admin 角色是否有 stats:view 权限
    const sysAdminPerms = await prisma.role_permissions.findMany({
      where: { role: 'sys_admin' },
      include: { permission: true },
    });
    const hasStatsView = sysAdminPerms.some(rp => rp.permission.code === 'stats:view');
    console.log(`\n2. sys_admin 角色有 stats:view 权限吗? ${hasStatsView ? '✅ 是' : '❌ 否'}`);

    // 3. 检查用户ID 10的权限
    const userId = 10n;
    const userRoles = await prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    const roles = userRoles.map(ur => ur.role);
    console.log(`\n3. 用户ID ${userId} 的角色: ${roles.join(', ')}`);

    if (roles.includes('sys_admin')) {
      const allPermissions = await prisma.permissions.findMany({
        select: { code: true },
      });
      const hasStats = allPermissions.some(p => p.code === 'stats:view');
      console.log(`   用户有 stats:view 权限吗? ${hasStats ? '✅ 是' : '❌ 否'}`);
    }

    console.log('\n========== 验证完成 ==========');

  } catch (error) {
    console.error('❌ 验证失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyStatsPermission();
