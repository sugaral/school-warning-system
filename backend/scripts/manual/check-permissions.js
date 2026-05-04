const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPermissions() {
  try {
    // 查询所有角色权限关系
    const rolePermissions = await prisma.role_permissions.findMany({
      include: {
        permission: true
      }
    });

    // 按角色分组
    const permissionsByRole = {};
    rolePermissions.forEach(rp => {
      if (!permissionsByRole[rp.role]) {
        permissionsByRole[rp.role] = [];
      }
      permissionsByRole[rp.role].push(rp.permission);
    });

    console.log('=== 角色权限分配 ===');
    for (const [role, perms] of Object.entries(permissionsByRole)) {
      console.log(`\n角色: ${role}`);
      console.log('权限:');
      perms.forEach(perm => {
        console.log(`  - ${perm.name} (${perm.code})`);
      });
    }

    // 查询所有用户角色
    const userRoles = await prisma.user_roles.findMany();

    console.log('\n\n=== 用户角色分配 ===');
    const rolesByUser = {};
    userRoles.forEach(ur => {
      if (!rolesByUser[ur.user_id]) {
        rolesByUser[ur.user_id] = [];
      }
      rolesByUser[ur.user_id].push(ur);
    });

    for (const [userId, roles] of Object.entries(rolesByUser)) {
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) }
      });
      if (user) {
        console.log(`\n用户: ${user.username} (ID: ${userId})`);
        roles.forEach(ur => {
          console.log(`  - 角色: ${ur.role}, 范围: ${ur.scope_type}${ur.scope_id ? `/${ur.scope_id}` : ''}`);
        });
      }
    }

  } catch (error) {
    console.error('查询失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPermissions();
