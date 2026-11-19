/**
 * 演示历史数据生成器（补齐 §12.1「seed 必须能一键生成可演示的完整数据」）
 *
 * 为什么需要它：
 * `prisma/seed.ts` 只创建组织/用户/班级/课程/规则等**主数据**，
 * 不产生任何 `daily_records` / `attendance_records` / `grades`。
 * 而预警引擎与三张汇总表全部依赖这些历史明细 —— 没有它们，
 * 预警永不触发、汇总表永远是空的，无法验收。
 *
 * 设计要点：
 *  - **幂等**：所有写入走 upsert，依赖唯一键
 *      daily_records(student_id, record_date, course_id)
 *      grades(student_id, course_id, term_code)
 *    可重复执行不产生重复行。
 *  - **确定性**：使用固定种子 PRNG，每次生成同样的数据，便于回归对比。
 *  - **course_id 绝不为 NULL**（§7.3：唯一键含 NULL 会失效）。
 *  - 统计特征经过设计，确保预警指标**真的能被触发**：
 *      学生 20230003 —— 高频迟到/缺勤（触发 late/absent 橙、红预警）
 *      学生 20230005 —— 高频作业未交 + 课堂违纪（触发 homework/behavior 指标）
 *      其余学生       —— 低频率，用于对照不触发
 *
 * 用法: npx ts-node prisma/seed-demo-history.ts [--weeks=8] [--term=2025-SPRING]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(name: string, fallback: string): string {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const WEEKS = Math.max(1, Math.min(52, Number(argValue('weeks', '8'))));
const TERM_CODE = argValue('term', '2025-SPRING');

/** 确定性 PRNG（mulberry32），保证可重复生成 */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 纯 UTC 日期加减，避免宿主机时区影响归属日 */
function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function dateOnlyUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * 每名学生的行为画像：决定各状态的抽样权重。
 * 权重设计目的 = 让不同 metric 都能被真实触发，同时保留对照组。
 */
interface Persona {
  studentNo: string;
  label: string;
  late: number;
  absent: number;
  earlyLeave: number;
  leave: number;
  notSubmit: number;
  lateSubmit: number;
  disruptive: number;
}

const PERSONAS: Persona[] = [
  { studentNo: '20230001', label: '正常', late: 0.03, absent: 0.01, earlyLeave: 0.02, leave: 0.03, notSubmit: 0.05, lateSubmit: 0.05, disruptive: 0.02 },
  // 迟到/缺勤重度 → 触发 late、absent 指标（周/月窗口）
  { studentNo: '20230002', label: '迟到偏多', late: 0.30, absent: 0.06, earlyLeave: 0.05, leave: 0.03, notSubmit: 0.08, lateSubmit: 0.08, disruptive: 0.03 },
  // 最严重 → 触发 red / severe 级别
  { studentNo: '20230003', label: '迟到+缺勤重度', late: 0.55, absent: 0.25, earlyLeave: 0.10, leave: 0.02, notSubmit: 0.20, lateSubmit: 0.15, disruptive: 0.10 },
  { studentNo: '20230004', label: '正常', late: 0.04, absent: 0.02, earlyLeave: 0.02, leave: 0.04, notSubmit: 0.06, lateSubmit: 0.06, disruptive: 0.02 },
  // 作业/课堂行为重度 → 触发 homework_not_submit、class_behavior 指标
  { studentNo: '20230005', label: '作业未交+违纪重度', late: 0.08, absent: 0.05, earlyLeave: 0.04, leave: 0.02, notSubmit: 0.60, lateSubmit: 0.20, disruptive: 0.45 },
];

function pick(rng: () => number, weights: Array<[string, number]>): string {
  const r = rng();
  let acc = 0;
  for (const [value, w] of weights) {
    acc += w;
    if (r < acc) return value;
  }
  return weights[weights.length - 1][0];
}

async function main() {
  console.log(`开始生成演示历史数据：weeks=${WEEKS} term=${TERM_CODE}`);

  const students = await prisma.student_profiles.findMany({
    select: { id: true, student_no: true, class_id: true, org_id: true },
    orderBy: { id: 'asc' },
  });
  if (students.length === 0) {
    throw new Error('没有学生档案，请先执行 prisma/seed.ts');
  }

  // student_profiles.org_id 可空，但 classes.org_id 非空 → 用班级组织兜底
  const classRows = await prisma.classes.findMany({
    select: { id: true, org_id: true },
  });
  const orgIdByClass = new Map<string, bigint>(
    classRows.map((c) => [c.id.toString(), c.org_id]),
  );

  // 班级 → 该班开设的课程（用于把 daily_records 关联到真实课程）
  const courseClasses = await prisma.course_classes.findMany({
    select: { course_id: true, class_id: true },
  });
  const coursesByClass = new Map<string, bigint[]>();
  for (const cc of courseClasses) {
    const key = cc.class_id.toString();
    const list = coursesByClass.get(key) || [];
    list.push(cc.course_id);
    coursesByClass.set(key, list);
  }

  // 以一个固定基准日往回推 WEEKS 周，保证覆盖「今天/本周/本月」窗口
  const today = dateOnlyUtc(new Date());
  const startDate = addDays(today, -(WEEKS * 7 - 1));

  let dailyCreated = 0;
  let gradesCreated = 0;

  for (const student of students) {
    const persona =
      PERSONAS.find((p) => p.studentNo === student.student_no) ||
      // 未登记画像的学生用「正常」权重
      PERSONAS[0];

    const courseIds = coursesByClass.get(student.class_id.toString()) || [];
    if (courseIds.length === 0) {
      console.warn(`  跳过学生 ${student.student_no}：其班级没有开课记录`);
      continue;
    }

    // daily_records.org_id 非空：优先用学生档案，缺失则回退班级组织
    const orgId =
      student.org_id ?? orgIdByClass.get(student.class_id.toString()) ?? null;
    if (orgId === null) {
      console.warn(`  跳过学生 ${student.student_no}：无法解析组织 id`);
      continue;
    }

    // 每名学生独立 PRNG，保证可重复
    const rng = makeRng(1000 + Number(student.id));

    for (let dayOffset = 0; dayOffset < WEEKS * 7; dayOffset++) {
      const recordDate = addDays(startDate, dayOffset);
      const dow = recordDate.getUTCDay();
      if (dow === 0 || dow === 6) continue; // 周末不上课

      // 每天从该班课程里取 1~2 门（唯一键是 student+date+course，可多门）
      const courseCount = courseIds.length >= 2 && rng() < 0.5 ? 2 : 1;
      for (let i = 0; i < courseCount; i++) {
        const courseId = courseIds[Math.floor(rng() * courseIds.length)];

        const attendanceStatus = pick(rng, [
          ['on_time', 1 - (persona.late + persona.absent + persona.earlyLeave + persona.leave)],
          ['late', persona.late],
          ['absent', persona.absent],
          ['early_leave', persona.earlyLeave],
          ['leave', persona.leave],
        ]);

        const homeworkStatus = pick(rng, [
          ['submitted', 1 - (persona.notSubmit + persona.lateSubmit)],
          ['not_submit', persona.notSubmit],
          ['late_submit', persona.lateSubmit],
        ]);

        const classBehavior = pick(rng, [
          ['normal', 1 - persona.disruptive],
          ['disruptive', persona.disruptive],
        ]);

        await prisma.daily_records.upsert({
          where: {
            student_id_record_date_course_id: {
              student_id: student.id,
              record_date: recordDate,
              course_id: courseId,
            },
          },
          update: {
            attendance_status: attendanceStatus,
            homework_status: homeworkStatus,
            class_behavior: classBehavior,
            updated_at: new Date(),
          },
          create: {
            student_id: student.id,
            record_date: recordDate,
            class_id: student.class_id,
            org_id: orgId,
            course_id: courseId,
            attendance_status: attendanceStatus,
            homework_status: homeworkStatus,
            class_behavior: classBehavior,
            remarks: null,
            source: 'auto',
            approved_status: 'approved',
          },
        });
        dailyCreated++;
      }
    }

    // 学期成绩：每门课一条，重度学生更可能挂科
    const severe = persona.label.includes('重度');
    for (const courseId of courseIds) {
      const pass = rng() > (severe ? 0.45 : 0.12);
      const score = pass ? 60 + rng() * 40 : 20 + rng() * 39;
      const gradePoint = pass ? Number((1.0 + (score - 60) * 0.13).toFixed(2)) : 0;

      await prisma.grades.upsert({
        where: {
          student_id_course_id_term_code: {
            student_id: student.id,
            course_id: courseId,
            term_code: TERM_CODE,
          },
        },
        update: {
          score: Number(score.toFixed(2)),
          grade_point: gradePoint,
          pass_status: pass ? 'pass' : 'fail',
          updated_at: new Date(),
        },
        create: {
          student_id: student.id,
          course_id: courseId,
          term_code: TERM_CODE,
          score: Number(score.toFixed(2)),
          grade_point: gradePoint,
          pass_status: pass ? 'pass' : 'fail',
          source: 'import',
        },
      });
      gradesCreated++;
    }
  }

  console.log('\n===== 生成完成 =====');
  console.log(`daily_records upsert 次数: ${dailyCreated}`);
  console.log(`grades        upsert 次数: ${gradesCreated}`);

  const counts = await prisma.$queryRaw<Array<{ t: string; c: bigint }>>`
    SELECT 'daily_records' AS t, COUNT(*) AS c FROM daily_records
    UNION ALL SELECT 'grades', COUNT(*) FROM grades
    UNION ALL SELECT 'distinct_students', COUNT(DISTINCT student_id) FROM daily_records
  `;
  for (const row of counts) {
    console.log(`  ${row.t}: ${row.c}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
