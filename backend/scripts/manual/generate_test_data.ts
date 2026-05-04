import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    await prisma.daily_records.deleteMany({});
    await prisma.warnings.deleteMany({});
    await prisma.notification_jobs.deleteMany({});
    console.log('已清空之前的测试数据');

    const student = await prisma.student_profiles.findFirst();
    const today = new Date();
    const createdRecords = [];
    const orgId = student.org_id !== null ? student.org_id : BigInt(0);

    // A. 迟到 (1次黄, 3次橙) 
    // 为确保在同一个自然周内，我们将这3次迟到全部塞进同一天
    for (let i = 0; i < 3; i++) {
        createdRecords.push({
            student_id: student.id,
            class_id: student.class_id,
            org_id: orgId,
            record_date: today,
            course_id: BigInt(99000 + i),
            attendance_status: 'late',
            homework_status: 'unknown',
            source: 'manual',
            approved_status: 'approved'
        });
    }

    // B. 旷课(1次黄-天，3次红-天，5次严重-周) -> 同一天造3次, 另外两天如果跨周可能引发不准确，我们干脆在同一天造5次旷课！
    for (let i = 0; i < 6; i++) {
        createdRecords.push({
            student_id: student.id,
            class_id: student.class_id,
            org_id: orgId,
            record_date: today,
            course_id: BigInt(99100 + i),
            attendance_status: 'absent',
            homework_status: 'unknown',
            source: 'manual',
            approved_status: 'approved'
        });
    }

    await prisma.daily_records.createMany({
        data: createdRecords
    });
    console.log(`重新注入测试数据完成: 3 次迟到，6 次旷课。全在今天，确保必定撞击 [天] 与 [周] 规则！`);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
