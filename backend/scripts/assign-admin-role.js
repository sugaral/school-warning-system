const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function assignAdminRole() {
  console.log('========== 为管理员分配角色 ==========\n');

  try {
    // 1. 查找所有教师/管理员类型的用户
    const adminUsers = await prisma.users.findMany({
      where: {
        user_type: {
          in: ['teacher', 'admin'],
        },
      },
      take: 10,
    });

    console.log(`找到 ${adminUsers.length} 个教师/管理员用户:\n`);
    
    for (const user of adminUsers) {
      console.log(`ID: ${user.id}, 姓名: ${user.name}, 类型: ${user.user_type}, 职位: ${user.teacher_position || '无'}`);
      
      // 检查是否已有角色
      const existingRoles = await prisma.user_roles.findMany({
        where: { user_id: user.id },
      });
      
      if (existingRoles.length > 0) {
        console.log(`  已有角色: ${existingRoles.map(r => r.role).join(', ')}`);
      } else {
        console.log(`  当前无角色`);
        
        // 根据用户类型分配默认角色
        let defaultRole = 'teaching_admin'; // 默认教务管理员
        let scopeType = 'school';
        
        if (user.teacher_position?.includes('班主任')) {
          defaultRole = 'head_teacher';
          scopeType = 'class';
        } else if (user.teacher_position?.includes('学工')) {
          defaultRole = 'student_admin';
          scopeType = 'college';
        } else if (user.teacher_position?.includes('院长')) {
          defaultRole = 'vice_dean';
          scopeType = 'college';
        }
        
        // 为第一个教师用户分配 sys_admin 角色（作为系统管理员）
        if (adminUsers.indexOf(user) === 0) {
          defaultRole = 'sys_admin';
          scopeType = 'system';
          console.log(`  → 分配为系统管理员(sys_admin)`);
        } else {
          console.log(`  → 分配为${defaultRole}`);
        }
        
        // 创建角色分配
        await prisma.user_roles.create({
          data: {
            user_id: user.id,
            role: defaultRole,
            scope_type: scopeType,
          },
        });
        
        console.log(`  ✅ 角色分配成功！`);
      }
      console.log('');
    }

    // 2. 验证分配结果
    console.log('\n========== 验证角色分配结果 ==========');
    const allUserRoles = await prisma.user_roles.groupBy({
      by: ['role'],
      _count: { user_id: true },
    });
    
    for (const ur of allUserRoles) {
      console.log(`  ${ur.role}: ${ur._count.user_id} 个用户`);
    }

    // 3. 检查sys_admin权限
    const sysAdminRoles = await prisma.user_roles.findMany({
      where: { role: 'sys_admin' },
    });
    
    console.log('\n系统管理员用户:');
    for (const sa of sysAdminRoles) {
      const user = await prisma.users.findUnique({
        where: { id: sa.user_id },
      });
      console.log(`  - ${user?.name || '未知'} (ID: ${sa.user_id})`);
    }

    console.log('\n========== 完成 ==========');

  } catch (error) {
    console.error('❌ 分配失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

assignAdminRole();
