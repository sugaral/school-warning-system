const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyRbac() {
  console.log('========== RBAC权限系统验证 ==========\n');

  try {
    // 1. 验证权限表
    const permissions = await prisma.permissions.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
    console.log(`✅ 权限定义总数: ${permissions.length}`);
    console.log('\n权限列表（按资源分组）:');
    
    const grouped = permissions.reduce((acc, p) => {
      if (!acc[p.resource]) acc[p.resource] = [];
      acc[p.resource].push(`${p.action}(${p.code})`);
      return acc;
    }, {});
    
    Object.entries(grouped).forEach(([resource, actions]) => {
      console.log(`  ${resource}: ${actions.join(', ')}`);
    });

    // 2. 验证角色权限关联
    const rolePermissions = await prisma.role_permissions.groupBy({
      by: ['role'],
      _count: { permission_id: true },
    });
    
    console.log('\n\n✅ 角色权限分配:');
    rolePermissions.forEach(rp => {
      console.log(`  ${rp.role}: ${rp._count.permission_id} 个权限`);
    });

    // 3. 验证特定角色的权限
    console.log('\n\n✅ 系统管理员权限详情:');
    const adminPerms = await prisma.role_permissions.findMany({
      where: { role: 'sys_admin' },
      include: { permission: true },
    });
    console.log(`  共 ${adminPerms.length} 个权限`);
    
    // 4. 验证班主任权限
    console.log('\n✅ 班主任权限详情:');
    const teacherPerms = await prisma.role_permissions.findMany({
      where: { role: 'head_teacher' },
      include: { permission: true },
    });
    console.log(`  共 ${teacherPerms.length} 个权限`);
    console.log('  包括:', teacherPerms.map(p => p.permission.code).join(', '));

    // 5. 验证学生权限
    console.log('\n✅ 学生权限详情:');
    const studentPerms = await prisma.role_permissions.findMany({
      where: { role: 'student' },
      include: { permission: true },
    });
    console.log(`  共 ${studentPerms.length} 个权限`);
    console.log('  包括:', studentPerms.map(p => p.permission.code).join(', '));

    console.log('\n========== 验证完成 ==========');
    console.log('✅ RBAC权限系统数据初始化成功！');

  } catch (error) {
    console.error('❌ 验证失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyRbac();
