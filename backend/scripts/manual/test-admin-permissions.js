const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testAdminPermissions() {
  console.log('========== 测试管理员权限 ==========\n');

  try {
    // 测试用户ID为1的管理员
    const userId = BigInt(1);
    
    // 1. 获取用户角色
    const userRoles = await prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    console.log('用户角色:', userRoles.map(r => r.role).join(', '));
    
    // 2. 获取用户权限
    const roles = userRoles.map((ur) => ur.role);
    
    if (roles.includes('sys_admin')) {
      console.log('✅ 是系统管理员，拥有所有权限');
      const allPermissions = await prisma.permissions.findMany({
        select: { code: true },
      });
      console.log(`权限总数: ${allPermissions.length}`);
      
      // 检查几个关键权限
      const keyPermissions = ['student:read', 'class:read', 'warning:read', 'user:manage'];
      console.log('\n关键权限检查:');
      for (const perm of keyPermissions) {
        const hasPerm = allPermissions.some(p => p.code === perm);
        console.log(`  ${perm}: ${hasPerm ? '✅' : '❌'}`);
      }
    } else {
      console.log('❌ 不是系统管理员');
      
      // 获取角色权限
      const rolePermissions = await prisma.role_permissions.findMany({
        where: {
          role: {
            in: roles,
          },
        },
        include: {
          permission: true,
        },
      });
      
      const permissions = [...new Set(rolePermissions.map((rp) => rp.permission.code))];
      console.log(`权限数: ${permissions.length}`);
      console.log('权限列表:', permissions.join(', '));
    }

    console.log('\n========== 测试完成 ==========');

  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAdminPermissions();
