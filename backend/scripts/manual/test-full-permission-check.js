const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testFullPermissionCheck() {
  console.log('========== 测试完整的权限检查流程 ==========\n');

  try {
    // 1. 获取用户ID 10（你注册的用户）
    const userId = 10n;
    console.log(`1. 测试用户ID: ${userId}`);

    // 2. 检查用户角色
    const userRoles = await prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    console.log(`\n2. 用户角色:`);
    userRoles.forEach(ur => {
      console.log(`   - ${ur.role} (scope: ${ur.scope_type})`);
    });

    // 3. 模拟getUserPermissions方法
    const roles = userRoles.map((ur) => ur.role);
    console.log(`\n3. 角色列表: ${roles.join(', ')}`);

    if (roles.includes('sys_admin')) {
      console.log(`   ✅ 用户是 sys_admin`);
      const allPermissions = await prisma.permissions.findMany({
        select: { code: true },
      });
      console.log(`   sys_admin 拥有 ${allPermissions.length} 个权限`);
      console.log(`   第一个权限: ${allPermissions[0]?.code}`);
      console.log(`   最后一个权限: ${allPermissions[allPermissions.length - 1]?.code}`);

      // 检查是否有 system:config 权限
      const hasSystemConfig = allPermissions.some(p => p.code === 'system:config');
      console.log(`   有 system:config 权限吗? ${hasSystemConfig ? '✅ 有' : '❌ 没有'}`);
    } else {
      console.log(`   ❌ 用户不是 sys_admin`);
    }

    // 4. 直接查询数据库检查权限关联
    console.log(`\n4. 检查 sys_admin 角色的权限关联:`);
    const sysAdminPerms = await prisma.role_permissions.findMany({
      where: { role: 'sys_admin' },
      include: { permission: true },
    });
    console.log(`   sys_admin 有 ${sysAdminPerms.length} 个权限关联`);

    const sysAdminPermCodes = sysAdminPerms.map(rp => rp.permission.code);
    console.log(`   权限列表前5个: ${sysAdminPermCodes.slice(0, 5).join(', ')}`);
    console.log(`   包含 system:config 吗? ${sysAdminPermCodes.includes('system:config') ? '✅ 是' : '❌ 否'}`);

    // 5. 测试权限检查逻辑
    console.log(`\n5. 测试权限检查逻辑:`);
    const requiredPermission = 'system:config';
    
    // 模拟 getUserPermissions
    const userPermissions = roles.includes('sys_admin') 
      ? (await prisma.permissions.findMany({ select: { code: true } })).map(p => p.code)
      : [];
    
    console.log(`   所需权限: ${requiredPermission}`);
    console.log(`   用户权限数: ${userPermissions.length}`);
    console.log(`   用户是否有该权限: ${userPermissions.includes(requiredPermission) ? '✅ 有' : '❌ 没有'}`);

    console.log('\n========== 测试完成 ==========');

  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testFullPermissionCheck();
