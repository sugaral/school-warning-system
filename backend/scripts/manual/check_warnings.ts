
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Warnings Diagnostic ---');

  // 1. Check Student
  const student = await prisma.student_profiles.findUnique({
    where: { id: 1n },
    include: { users: true }
  });
  if (student) {
    console.log(`✅ Student ID 1 exists: ${student.users?.name} (UserID: ${student.user_id})`);
  } else {
    console.log('❌ Student ID 1 MISSING');
  }

  // 2. Check Class
  const cls = await prisma.classes.findUnique({
    where: { id: 1n }
  });
  if (cls) {
    console.log(`✅ Class ID 1 exists: ${cls.class_name}`);
  } else {
    console.log('❌ Class ID 1 MISSING');
  }

  // 3. Check Org
  const org = await prisma.orgs.findUnique({
    where: { id: 2n }
  });
  if (org) {
    console.log(`✅ Org ID 2 exists: ${org.name}`);
  } else {
    console.log('❌ Org ID 2 MISSING');
  }

  // 4. Check Rule
  const rule = await prisma.warning_rules.findUnique({
    where: { id: 7n }
  });
  if (rule) {
    console.log(`✅ Warning Rule ID 7 exists: ${rule.metric}`);
  } else {
    console.log('❌ Warning Rule ID 7 MISSING');
  }

  // 5. Check Warning Record
  const warning = await prisma.warnings.findFirst({
    where: { student_id: 1n }
  });
  if (warning) {
    console.log('✅ Warning record found for Student 1:');
    console.log(`   ID: ${warning.id}`);
    console.log(`   Status: ${warning.status}`);
    console.log(`   ClassID: ${warning.class_id}`);
    console.log(`   OrgID: ${warning.org_id}`);
    
    if (warning.status === 'active') {
      console.log('⚠️  Status is "active", but backend expects "open" or "acknowledged" by default!');
    }
  } else {
    console.log('❌ No warning record found for Student 1');
  }

  console.log('--- Diagnostic Complete ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
