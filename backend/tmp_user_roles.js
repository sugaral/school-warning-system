const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function stringifyBigInt(value) {
  return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
}

async function run() {
  const id = BigInt(process.argv[2] || '647');
  const rows = await prisma.user_roles.findMany({ where: { user_id: id } });
  console.log(stringifyBigInt({ userId: id, count: rows.length, rows }));
  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
