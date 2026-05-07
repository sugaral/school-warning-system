/**
 * 数据初始化脚本
 * 用法: npx ts-node prisma/seed.ts
 *
 * 创建测试数据：
 * - 组织（学校、学院）
 * - 班级
 * - 管理员用户（含 bcrypt 加密密码）
 * - 教师用户
 * - 学生用户
 * - 角色权限
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('开始初始化数据...');

  // 清理现有数据（可选，开发阶段使用）
  console.log('清理现有数据...');
  await prisma.audit_logs.deleteMany().catch(() => {});
  await prisma.notification_logs.deleteMany().catch(() => {});
  await prisma.notification_jobs.deleteMany().catch(() => {});
  await prisma.appeals.deleteMany().catch(() => {});
  await prisma.makeup_requests.deleteMany().catch(() => {});
  await prisma.leave_requests.deleteMany().catch(() => {});
  await prisma.daily_records.deleteMany().catch(() => {});
  await prisma.attendance_records.deleteMany().catch(() => {});
  await prisma.class_sessions.deleteMany().catch(() => {});
  await prisma.user_roles.deleteMany().catch(() => {});
  await prisma.student_profiles.deleteMany().catch(() => {});
  await prisma.users.deleteMany().catch(() => {});
  await prisma.classes.deleteMany().catch(() => {});
  await prisma.orgs.deleteMany().catch(() => {});

  // 1. 创建组织
  console.log('创建组织...');
  const school = await prisma.orgs.create({
    data: {
      name: '某某大学',
      org_kind: 'school',
      org_level: 1,
      status: 'active',
      meta_json: { contact: '教务处', phone: '010-12345678' },
    },
  });

  const college = await prisma.orgs.create({
    data: {
      name: '计算机学院',
      org_kind: 'college',
      org_level: 2,
      parent_org_id: school.id,
      status: 'active',
      meta_json: { contact: '学院办公室', phone: '010-87654321' },
    },
  });

  // 2. 创建班级
  console.log('创建班级...');
  const class1 = await prisma.classes.create({
    data: {
      org_id: college.id,
      class_name: '2023级软件工程1班',
      enroll_year: 2023,
      major: '软件工程',
      grade_level: '大一',
      status: 'active',
    },
  });

  const class2 = await prisma.classes.create({
    data: {
      org_id: college.id,
      class_name: '2023级计算机科学1班',
      enroll_year: 2023,
      major: '计算机科学与技术',
      grade_level: '大一',
      status: 'active',
    },
  });

  // 3. 创建管理员用户
  console.log('创建管理员用户...');
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.users.create({
    data: {
      org_id: school.id,
      user_type: 'admin',
      name: '系统管理员',
      mobile: '13800138000',
      email: 'admin@school.edu.cn',
      status: 'active',
      password_hash: adminPassword,
    },
  });

  // 4. 创建教师用户
  console.log('创建教师用户...');
  const teacherPassword = await bcrypt.hash('teacher123', 10);
  const teacher1 = await prisma.users.create({
    data: {
      org_id: college.id,
      user_type: 'teacher',
      name: '张老师',
      mobile: '13800138001',
      email: 'teacher1@school.edu.cn',
      status: 'active',
      password_hash: teacherPassword,
    },
  });

  const teacher2 = await prisma.users.create({
    data: {
      org_id: college.id,
      user_type: 'teacher',
      name: '李老师',
      mobile: '13800138002',
      email: 'teacher2@school.edu.cn',
      status: 'active',
      password_hash: teacherPassword,
    },
  });

  // 5. 创建学工人员
  console.log('创建学工人员...');
  const staffPassword = await bcrypt.hash('staff123', 10);
  const staff = await prisma.users.create({
    data: {
      org_id: college.id,
      user_type: 'staff',
      name: '王学工',
      mobile: '13800138003',
      email: 'staff1@school.edu.cn',
      status: 'active',
      password_hash: staffPassword,
    },
  });

  // 6. 创建学生用户
  console.log('创建学生用户...');
  const students = [];
  for (let i = 1; i <= 5; i++) {
    const student = await prisma.users.create({
      data: {
        org_id: college.id,
        user_type: 'student',
        name: `学生${i}`,
        mobile: `1390013800${i}`,
        email: `student${i}@school.edu.cn`,
        status: 'active',
      },
    });
    students.push(student);
  }

  // 7. 创建学生档案
  console.log('创建学生档案...');
  for (let i = 0; i < students.length; i++) {
    await prisma.student_profiles.create({
      data: {
        user_id: students[i].id,
        student_no: `2023${String(i + 1).padStart(4, '0')}`,
        gender: i % 2 === 0 ? '男' : '女',
        class_id: i < 3 ? class1.id : class2.id,
        org_id: college.id,
        major: i < 3 ? '软件工程' : '计算机科学与技术',
        enroll_year: 2023,
        mobile: students[i].mobile,
        email: students[i].email,
        emergency_contact_name: `家长${i + 1}`,
        emergency_contact_mobile: `1370013700${i + 1}`,
        notify_prefs_json: {
          wechat: true,
          sms: true,
          email: false,
          quiet_hours: { start: '22:00', end: '08:00' },
        },
        status: 'active',
      },
    });
  }

  // 8. 分配角色
  console.log('分配角色...');
  // 管理员 - 系统级
  await prisma.user_roles.create({
    data: {
      user_id: admin.id,
      role: 'sys_admin',
      scope_type: 'system',
      scope_id: null,
    },
  });

  // 教师1 - 班主任（班级范围）
  await prisma.user_roles.create({
    data: {
      user_id: teacher1.id,
      role: 'head_teacher',
      scope_type: 'class',
      scope_id: class1.id,
    },
  });

  // 教师2 - 任课教师（班级范围）
  await prisma.user_roles.create({
    data: {
      user_id: teacher2.id,
      role: 'teacher',
      scope_type: 'class',
      scope_id: class2.id,
    },
  });

  // 学工 - 学院范围
  await prisma.user_roles.create({
    data: {
      user_id: staff.id,
      role: 'student_admin',
      scope_type: 'college',
      scope_id: college.id,
    },
  });

  // 学生 - 班长（班级范围）
  await prisma.user_roles.create({
    data: {
      user_id: students[0].id,
      role: 'class_monitor',
      scope_type: 'class',
      scope_id: class1.id,
    },
  });

  // 普通学生角色
  for (const student of students) {
    await prisma.user_roles.create({
      data: {
        user_id: student.id,
        role: 'student',
        scope_type: 'self',
        scope_id: student.id,
      },
    });
  }

  // 9. 创建课程
  console.log('创建课程...');
  const course1 = await prisma.courses.create({
    data: {
      org_id: college.id,
      course_code: 'CS101',
      course_name: '计算机导论',
      credit: 3.0,
      status: 'active',
    },
  });

  const course2 = await prisma.courses.create({
    data: {
      org_id: college.id,
      course_code: 'CS102',
      course_name: '程序设计基础',
      credit: 4.0,
      status: 'active',
    },
  });

  const course3 = await prisma.courses.create({
    data: {
      org_id: college.id,
      course_code: 'CS103',
      course_name: '数据结构',
      credit: 4.0,
      status: 'active',
    },
  });

  // 10. 创建开课班
  console.log('创建开课班...');
  const termCode = '2025-SPRING';

  await prisma.course_classes.create({
    data: {
      course_id: course1.id,
      class_id: class1.id,
      teacher_user_id: teacher1.id,
      term_code: termCode,
    },
  });

  await prisma.course_classes.create({
    data: {
      course_id: course2.id,
      class_id: class1.id,
      teacher_user_id: teacher1.id,
      term_code: termCode,
    },
  });

  await prisma.course_classes.create({
    data: {
      course_id: course1.id,
      class_id: class2.id,
      teacher_user_id: teacher2.id,
      term_code: termCode,
    },
  });

  await prisma.course_classes.create({
    data: {
      course_id: course3.id,
      class_id: class2.id,
      teacher_user_id: teacher2.id,
      term_code: termCode,
    },
  });

  // 11. 创建预警规则
  console.log('创建预警规则...');
  
  // 迟到规则
  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'yellow',
      window: 'day',
      metric: 'late',
      threshold: 1,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat'],
        cooldown_hours: 24,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'orange',
      window: 'week',
      metric: 'late',
      threshold: 3,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'red',
      window: 'month',
      metric: 'late',
      threshold: 6,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'severe',
      window: 'term',
      metric: 'late',
      threshold: 10,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  // 缺勤规则
  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'yellow',
      window: 'day',
      metric: 'absent',
      threshold: 1,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat'],
        cooldown_hours: 24,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'orange',
      window: 'week',
      metric: 'absent',
      threshold: 2,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'red',
      window: 'month',
      metric: 'absent',
      threshold: 4,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'severe',
      window: 'term',
      metric: 'absent',
      threshold: 8,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  // 早退规则
  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'yellow',
      window: 'day',
      metric: 'early_leave',
      threshold: 1,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat'],
        cooldown_hours: 24,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'orange',
      window: 'week',
      metric: 'early_leave',
      threshold: 3,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'red',
      window: 'month',
      metric: 'early_leave',
      threshold: 5,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'severe',
      window: 'term',
      metric: 'early_leave',
      threshold: 8,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  // 未交作业规则
  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'yellow',
      window: 'day',
      metric: 'homework_not_submit',
      threshold: 1,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat'],
        cooldown_hours: 24,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'orange',
      window: 'week',
      metric: 'homework_not_submit',
      threshold: 2,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'red',
      window: 'month',
      metric: 'homework_not_submit',
      threshold: 4,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  await prisma.warning_rules.create({
    data: {
      scope: 'school',
      level: 'severe',
      window: 'term',
      metric: 'homework_not_submit',
      threshold: 6,
      enabled: true,
      notify_strategy_json: {
        channels: ['wechat', 'sms', 'email'],
        cooldown_hours: 24,
        require_ack: true,
      },
      created_by: admin.id,
    },
  });

  // 12. 创建消息模板
  console.log('创建消息模板...');
  await prisma.message_templates.create({
    data: {
      channel: 'wechat',
      template_code: 'YELLOW_WARNING',
      title: '黄色预警通知',
      content: '同学你好，你今日有迟到记录，请注意准时上课。',
      status: 'active',
      created_by: admin.id,
    },
  });

  await prisma.message_templates.create({
    data: {
      channel: 'wechat',
      template_code: 'ORANGE_WARNING',
      title: '橙色预警通知',
      content: '同学你好，你本周迟到次数已达{late_count}次，请注意改善。',
      status: 'active',
      created_by: admin.id,
    },
  });

  await prisma.message_templates.create({
    data: {
      channel: 'wechat',
      template_code: 'RED_WARNING',
      title: '红色预警通知',
      content: '同学你好，你本月缺勤次数较多，请尽快联系班主任。',
      status: 'active',
      created_by: admin.id,
    },
  });

  await prisma.message_templates.create({
    data: {
      channel: 'wechat',
      template_code: 'SEVERE_WARNING',
      title: '严重预警通知',
      content: '同学你好，你本学期表现较差，请立即联系辅导员。',
      status: 'active',
      created_by: admin.id,
    },
  });

  console.log('\n✅ 数据初始化完成！');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 测试账号信息：');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`
【系统管理员】
  账号: ${admin.mobile} 或 ${admin.email}
  密码: admin123

【班主任 - 张老师】
  账号: ${teacher1.mobile} 或 ${teacher1.email}
  密码: teacher123

【任课教师 - 李老师】
  账号: ${teacher2.mobile} 或 ${teacher2.email}
  密码: teacher123

【学工人员 - 王学工】
  账号: ${staff.mobile} 或 ${staff.email}
  密码: staff123
  `);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
