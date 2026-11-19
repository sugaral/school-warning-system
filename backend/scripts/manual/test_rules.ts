import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const rules = await prisma.warning_rules.findMany({
        where: { enabled: true }
    });
    console.log('活跃规则:');
    console.table(rules.map(r => ({
        id: r.id,
        level: r.level,
        metric: r.metric,
        threshold: r.threshold,
        window: r.window
    })));
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
