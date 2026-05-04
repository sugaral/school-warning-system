
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Warning System Data Fix (JS) ---');

  try {
    // 1. Ensure Organization 2 exists
    await prisma.orgs.upsert({
      where: { id: BigInt(2) },
      update: {},
      create: {
        id: BigInt(2) ,
        name: '演示学院/机构',
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    console.log('✅ Organization 2 checked/created');

    // 2. Ensure Class 1 exists
    await prisma.classes.upsert({
      where: { id: BigInt(1) },
      update: { org_id: BigInt(2) },
      create: {
        id: BigInt(1),
        class_name: '演示班级',
        org_id: BigInt(2),
        major: '演示专业',
        grade: '2024',
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    console.log('✅ Class 1 checked/created');

    // 3. Ensure Student 1 exists
    await prisma.student_profiles.upsert({
      where: { id: BigInt(1) },
      update: { class_id: BigInt(1), org_id: BigInt(2) },
      create: {
        id: BigInt(1),
        user_id: BigInt(5),
        student_no: 'FIXED_001',
        class_id: BigInt(1),
        org_id: BigInt(2),
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
      }
    });
    console.log('✅ Student 1 checked/created');

    // 4. Update the Warning status to 'open'
    const updateResult = await prisma.warnings.updateMany({
      where: {
        OR: [
          { student_id: BigInt(1), status: 'active' },
          { id: BigInt(1) }
        ]
      },
      data: {
        status: 'open',
        class_id: BigInt(1),
        org_id: BigInt(2)
      }
    });

    console.log(`✅ Updated ${updateResult.count} warning records.`);
    console.log('\n--- Fix Complete ---');
  } catch (err) {
    console.error('❌ Error during fix:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
