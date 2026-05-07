const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const steps = [];
  async function timeit(name, fn) {
    const t = Date.now();
    const result = await fn();
    steps.push([name, Date.now() - t, Array.isArray(result) ? result.length : result]);
    return result;
  }

  await timeit('user_roles', () => prisma.user_roles.findMany({ where: { user_id: BigInt(1) } }));
  await timeit(
    'count_total',
    () => prisma.$queryRawUnsafe("SELECT COUNT(*) AS warning_total FROM warning_current_states WHERE metric <> 'warning_total' AND status IN ('open','acknowledged')"),
  );
  await timeit(
    'count_students',
    () => prisma.$queryRawUnsafe("SELECT COUNT(DISTINCT student_id) AS total FROM warning_current_states WHERE metric <> 'warning_total' AND status IN ('open','acknowledged')"),
  );
  const pageStudents = await timeit(
    'page_students',
    () => prisma.$queryRawUnsafe("SELECT student_id FROM (SELECT student_id, MAX(updated_at) AS latest_order FROM warning_current_states WHERE metric <> 'warning_total' AND status IN ('open','acknowledged') GROUP BY student_id ORDER BY latest_order DESC, student_id DESC LIMIT 20 OFFSET 0) page_students"),
  );
  const ids = pageStudents.map((x) => BigInt(x.student_id));
  const warnings = await timeit(
    'warnings_findMany',
    () => prisma.warning_current_states.findMany({
      where: {
        metric: { not: 'warning_total' },
        status: { in: ['open', 'acknowledged'] },
        student_id: { in: ids },
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    }),
  );
  const studentIds = [...new Set(warnings.map((x) => x.student_id.toString()))].map((x) => BigInt(x));
  const classIds = [...new Set(warnings.map((x) => x.class_id.toString()))].map((x) => BigInt(x));
  await timeit('students_classes', () => Promise.all([
    prisma.student_profiles.findMany({ where: { id: { in: studentIds } }, select: { id: true, users: { select: { name: true } } } }),
    prisma.classes.findMany({ where: { id: { in: classIds } }, select: { id: true, class_name: true, org_id: true, counselor_user_id: true } }),
  ]));

  console.log(JSON.stringify(steps));
}

main().finally(async () => {
  await prisma.$disconnect();
});
