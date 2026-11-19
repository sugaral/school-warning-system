const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function buildGroupKey(warning) {
  const start = warning.period_start.toISOString().slice(0, 10);
  const end = warning.period_end.toISOString().slice(0, 10);
  return [
    warning.student_id.toString(),
    warning.metric,
    warning.window,
    start,
    end,
    warning.status,
  ].join('|');
}

async function main() {
  const warnings = await prisma.warnings.findMany({
    where: {
      status: { in: ['open', 'acknowledged'] },
    },
    orderBy: [
      { created_at: 'desc' },
      { id: 'desc' },
    ],
    select: {
      id: true,
      student_id: true,
      metric: true,
      window: true,
      period_start: true,
      period_end: true,
      status: true,
      created_at: true,
    },
  });

  const groups = new Map();
  for (const warning of warnings) {
    const key = buildGroupKey(warning);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(warning);
  }

  let closedCount = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) {
      continue;
    }

    const [, ...duplicates] = group;
    const duplicateIds = duplicates.map((item) => item.id);

    const result = await prisma.warnings.updateMany({
      where: { id: { in: duplicateIds } },
      data: {
        status: 'closed',
        closed_at: new Date(),
        close_note: 'System deduplicated duplicate warning records',
      },
    });
    closedCount += result.count;
  }

  console.log(JSON.stringify({
    scanned: warnings.length,
    groups: groups.size,
    closed: closedCount,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
