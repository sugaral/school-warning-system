const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUserPermissions() {
  console.log('=== 检查用户 200 的权限 ===\n');

  // 1. 检查用户角色
  const userRoles = await prisma.user_roles.findMany({
    where: { user_id: BigInt(200) }
  });
  console.log('用户角色:');
  userRoles.forEach(ur => {
    console.log(`  - 角色: ${ur.role}, 范围: ${ur.scope_type}`);
  });

  // 2. 检查角色权限
  const roles = userRoles.map(ur => ur.role);
  console.log('\n角色权限:');
  for (const role of roles) {
    const rolePermissions = await prisma.role_permissions.findMany({
      where: { role },
      include: { permission: true }
    });
    console.log(`\n角色 ${role} 的权限:`);
    rolePermissions.forEach(rp => {
      console.log(`  - ${rp.permission.code}: ${rp.permission.name}`);
    });
  }

  // 3. 检查是否有 class:read 权限
  const hasClassRead = await prisma.role_permissions.findMany({
    where: {
      role: { in: roles },
      permission: { code: 'class:read' }
    },
    include: { permission: true }
  });
  console.log('\n=== 检查 class:read 权限 ===');
  console.log('是否找到 class:read 权限:', hasClassRead.length > 0);
  if (hasClassRead.length > 0) {
    hasClassRead.forEach(rp => {
      console.log(`  - 角色 ${rp.role} 拥有 ${rp.permission.code} 权限`);
    });
  }

  await prisma.$disconnect();
}

checkUserPermissions().catch(console.error);