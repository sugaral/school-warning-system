
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Warning System Data Fix (Granular) ---');

  try {
    // 1. Check/Seed Org 2
    console.log('Checking Org 2...');
    let org = await prisma.orgs.findUnique({ where: { id: BigInt(2) } });
    if (!org) {
      org = await prisma.orgs.create({
        data: { id: BigInt(2), name: '演示学院/机构' }
      });
      console.log('✅ Created Org 2');
    } else {
      console.log('✅ Org 2 already exists');
    }

    // 2. Check/Seed Class 1
    console.log('Checking Class 1...');
    let cls = await prisma.classes.findUnique({ where: { id: BigInt(1) } });
    if (!cls) {
      cls = await prisma.classes.create({
        data: { id: BigInt(1), class_name: '演示班级', org_id: BigInt(2), major: '演示专业', grade: '2024' }
      });
      console.log('✅ Created Class 1');
    } else {
      console.log('✅ Class 1 already exists');
    }

    // 3. Check/Seed Student 1
    console.log('Checking Student 1...');
    let student = await prisma.student_profiles.findUnique({ where: { id: BigInt(1) } });
    if (!student) {
      student = await prisma.student_profiles.create({
        data: { id: BigInt(1), user_id: BigInt(5), student_no: 'FIXED_001', class_id: BigInt(1), org_id: BigInt(2), status: 'active' }
      });
      console.log('✅ Created Student 1');
    } else {
      console.log('✅ Student 1 already exists');
    }

    // 4. Update Warning Record status
    console.log('Updating Warning records for Student 1...');
    const result = await prisma.warnings.updateMany({
      where: {
        student_id: BigInt(1),
        status: 'active'
      },
      data: {
        status: 'open', // 修正状态以匹配后端默认过滤器
        class_id: BigInt(1),
        org_id: BigInt(2)
      }
    });
    console.log(`✅ Updated ${result.count} records matching (student_id: 1, status: active)`);

    // 5. Update Warning ID 1 explicitly if it exists
    console.log('Explicitly checking Warning ID 1...');
    const w1 = await prisma.warnings.findUnique({ where: { id: BigInt(1) } });
    if (w1) {
      await prisma.warnings.update({
        where: { id: BigInt(1) },
        data: { status: 'open', class_id: BigInt(1), org_id: BigInt(2) }
      });
      console.log('✅ Successfully updated Warning record with ID 1 to "open"');
    }

  } catch (err) {
    console.error('❌ Error during fix process:', err);
  } finally {
    await prisma.$disconnect();
    console.log('\n--- Fix Complete ---');
  }
}

main();
