const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkAdminRole() {
  console.log('========== 检查系统管理员角色 ==========\n');

  try {
    // 1. 查找系统管理员用户
    const adminUsers = await prisma.users.findMany({
      where: {
        OR: [
          { name: { contains: 'admin' } },
          { name: { contains: '管理员' } },
        ],
      },
      take: 5,
    });

    console.log('找到的管理员用户:');
    for (const user of adminUsers) {
      console.log(`  ID: ${user.id}, 姓名: ${user.name}, 类型: ${user.user_type}`);
      
      // 检查用户的角色
      const roles = await prisma.user_roles.findMany({
        where: { user_id: user.id },
      });
      
      if (roles.length === 0) {
        console.log(`    ⚠️ 该用户没有分配任何角色！`);
      } else {
        console.log(`    角色: ${roles.map(r => `${r.role}(${r.scope_type})`).join(', ')}`);
        
        // 检查权限
        const rolePermissions = await prisma.role_permissions.findMany({
          where: {
            role: {
              in: roles.map(r => r.role),
            },
          },
          include: { permission: true },
        });
        
        const permissions = [...new Set(rolePermissions.map(rp => rp.permission.code))];
        console.log(`    权限数: ${permissions.length}`);
        console.log(`    包含user:manage: ${permissions.includes('user:manage')}`);
      }
    }

    // 2. 检查所有用户角色分配情况
    console.log('\n\n所有用户角色分配统计:');
    const allUserRoles = await prisma.user_roles.groupBy({
      by: ['role'],
      _count: { user_id: true },
    });
    
    for (const ur of allUserRoles) {
      console.log(`  ${ur.role}: ${ur._count.user_id} 个用户`);
    }

    // 3. 如果没有sys_admin角色分配，提示需要创建
    const sysAdminCount = allUserRoles.find(r => r.role === 'sys_admin')?._count.user_id || 0;
    if (sysAdminCount === 0) {
      console.log('\n⚠️ 警告：没有用户被分配 sys_admin 角色！');
      console.log('需要执行以下SQL为用户分配管理员角色:');
      console.log(`INSERT INTO user_roles (user_id, role, scope_type) VALUES (管理员用户ID, 'sys_admin', 'system');`);
    }

    console.log('\n========== 检查完成 ==========');

  } catch (error) {
    console.error('❌ 检查失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdminRole();
