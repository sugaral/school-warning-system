import { PrismaClient } from '@prisma/client';
import { WarningService } from '../../src/warning/warning.service';
import { PrismaService } from '../../src/shared/prisma.service';

async function main() {
    const prisma = new PrismaClient();
    const prismaService = new PrismaService(); // for warning service
    const warningService = new WarningService(prismaService);

    // 1. 清理环境
    console.log('清理历史数据...');
    await prisma.daily_records.deleteMany({});
    await prisma.warnings.deleteMany({});
    await prisma.notification_jobs.deleteMany({});

    // 2. 补齐 Severe 规则 (若无)
    const severeRule = await prisma.warning_rules.findFirst({ where: { level: 'severe', metric: 'absent' } });
    if (!severeRule) {
        await prisma.warning_rules.create({
            data: {
                scope: 'school',
                level: 'severe',
                metric: 'absent',
                threshold: 5,
                window: 'week',
                enabled: true,
                created_by: BigInt(1),
                notify_strategy_json: { channel: "wechat" }
            }
        });
    }

    // 3. 获取 4 名学生
    const students = await prisma.student_profiles.findMany({ take: 4 });
    if (students.length < 4) {
        throw new Error('数据库学生不足4名，无法完美分配 4 级演示');
    }

    const today = new Date();
    const records = [];

    // ====== A: 学生 0 -> 黄色预警 (迟到 1 次/日) ======
    records.push({
        student_id: students[0].id,
        class_id: students[0].class_id,
        org_id: students[0].org_id || BigInt(0),
        record_date: today,
        course_id: BigInt(100),
        attendance_status: 'late',
        homework_status: 'unknown',
        source: 'manual',
        approved_status: 'approved'
    });

    // ====== B: 学生 1 -> 橙色预警 (迟到 3 次/周) ======
    for (let i = 0; i < 3; i++) {
        records.push({
            student_id: students[1].id,
            class_id: students[1].class_id,
            org_id: students[1].org_id || BigInt(0),
            record_date: today, // 全丢在今天以确保必然在同一"周"内
            course_id: BigInt(200 + i),
            attendance_status: 'late',
            homework_status: 'unknown',
            source: 'manual',
            approved_status: 'approved'
        });
    }

    // ====== C: 学生 2 -> 红色预警 (旷课 3 次/日) ======
    for (let i = 0; i < 3; i++) {
        records.push({
            student_id: students[2].id,
            class_id: students[2].class_id,
            org_id: students[2].org_id || BigInt(0),
            record_date: today, // 全部在今天
            course_id: BigInt(300 + i),
            attendance_status: 'absent',
            homework_status: 'unknown',
            source: 'manual',
            approved_status: 'approved'
        });
    }

    // ====== D: 学生 3 -> 严重预警 (旷课 5 次/周) ======
    for (let i = 0; i < 5; i++) {
        records.push({
            student_id: students[3].id,
            class_id: students[3].class_id,
            org_id: students[3].org_id || BigInt(0),
            record_date: today, // 全丢在今天以确保必然在同一"周"内
            course_id: BigInt(400 + i),
            attendance_status: 'absent',
            homework_status: 'unknown',
            source: 'manual',
            approved_status: 'approved'
        });
    }

    await prisma.daily_records.createMany({ data: records });
    console.log('测试记录已成功注入！');

    // 4. 触发引擎扫描 (单例模式运行，避免定时器冲突)
    console.log('开始执行预警引擎分析...');
    await warningService.rescanAllViolations();

    // 5. 校验结果
    const activeWarnings = await prisma.warnings.findMany({
        where: { status: 'open' },
        orderBy: { level: 'desc' }
    });

    console.log('\n====== 🎉 预警生成效果报告 ======');
    const levelColors: any = { yellow: '🟡 黄色', orange: '🟠 橙色', red: '🔴 红色', severe: '🟣 严重' };

    activeWarnings.forEach(w => {
        console.log(`${levelColors[w.level] || w.level}预警 | 学生ID: ${w.student_id} | 触发描述: ${w.trigger_summary}`);
    });
    console.log('===================================\n');

    await prisma.$disconnect();
}

main().catch(console.error);
