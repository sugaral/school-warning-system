const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const userId = BigInt(process.argv[2] || '647');
  const pageNumber = 1;
  const size = 20;
  const where = { metric: { not: 'warning_total' }, status: { in: ['open', 'acknowledged'] } };

  const t0 = Date.now();
  const userRoles = await prisma.user_roles.findMany({ where: { user_id: userId } });
  const t1 = Date.now();

  const warningTotalsRows = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS warning_total FROM warning_current_states WHERE metric <> 'warning_total' AND status IN ('open','acknowledged')");
  const t2 = Date.now();

  const studentTotalRows = await prisma.$queryRawUnsafe("SELECT COUNT(DISTINCT student_id) AS total FROM warning_current_states WHERE metric <> 'warning_total' AND status IN ('open','acknowledged')");
  const t3 = Date.now();

  const skip = (pageNumber - 1) * size;
  const pageStudentRows = await prisma.$queryRawUnsafe("SELECT student_id FROM (SELECT student_id, MAX(updated_at) AS latest_order FROM warning_current_states WHERE metric <> 'warning_total' AND status IN ('open','acknowledged') GROUP BY student_id ORDER BY latest_order DESC, student_id DESC LIMIT 20 OFFSET 0) page_students");
  const t4 = Date.now();

  const pageStudentIds = pageStudentRows.map((item) => BigInt(item.student_id));
  const pageWhere = { ...where, student_id: { in: pageStudentIds } };

  const warnings = await prisma.warning_current_states.findMany({
    where: pageWhere,
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
  });
  const t5 = Date.now();

  const studentIds = [...new Set(warnings.map((item) => item.student_id.toString()))].map((v) => BigInt(v));
  const classIds = [...new Set(warnings.map((item) => item.class_id.toString()))].map((v) => BigInt(v));

  const [students, classes] = await Promise.all([
    prisma.student_profiles.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, users: { select: { name: true } } },
    }),
    prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: { id: true, class_name: true, org_id: true, counselor_user_id: true },
    }),
  ]);
  const t6 = Date.now();

  const teacherIds = [...new Set(classes.map((item) => item.counselor_user_id).filter(Boolean).map((v) => v.toString()))].map((v) => BigInt(v));
  const orgIds = [...new Set([...warnings.map((item) => item.org_id.toString()), ...classes.map((item) => item.org_id.toString())])].map((v) => BigInt(v));

  await Promise.all([
    teacherIds.length > 0 ? prisma.users.findMany({ where: { id: { in: teacherIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    orgIds.length > 0 ? prisma.orgs.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const t7 = Date.now();

  console.log(JSON.stringify({
    user_roles_ms: t1 - t0,
    count_total_ms: t2 - t1,
    count_students_ms: t3 - t2,
    page_students_ms: t4 - t3,
    warnings_ms: t5 - t4,
    students_classes_ms: t6 - t5,
    teachers_orgs_ms: t7 - t6,
    total_ms: t7 - t0,
    warning_total: Number(warningTotalsRows[0].warning_total || 0),
    student_total: Number(studentTotalRows[0].total || 0),
    page_students: pageStudentRows.length,
    warnings: warnings.length,
    students: students.length,
    classes: classes.length,
    skip,
    roles: userRoles.map((r) => r.role),
  }));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
