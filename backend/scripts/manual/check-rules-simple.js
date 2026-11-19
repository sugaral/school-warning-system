
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkWarningRules() {
  console.log('=== Check Warning Rules ===\n');
  
  try {
    const rules = await prisma.warning_rules.findMany({
      orderBy: [{ metric: 'asc' }, { window: 'asc' }, { threshold: 'asc' }]
    });
    
    console.log(`Found ${rules.length} warning rules:\n`);
    
    rules.forEach(rule =&gt; {
      console.log(`${rule.metric} | ${rule.window} | ${rule.level} | threshold: ${rule.threshold} | enabled: ${rule.enabled} | id: ${rule.id}`);
    });
    
    console.log('\n=== Check Absent Records ===\n');
    
    const absentRecords = await prisma.daily_records.findMany({
      where: { attendance_status: 'absent' },
      include: { student_profiles: { include: { users: true } } },
      orderBy: { record_date: 'desc' },
      take: 50
    });
    
    console.log(`Recent ${absentRecords.length} absent records:\n`);
    
    const studentAbsentCount = {};
    absentRecords.forEach(record =&gt; {
      const studentId = record.student_id.toString();
      if (!studentAbsentCount[studentId]) {
        studentAbsentCount[studentId] = {
          name: record.student_profiles?.users?.name || 'Unknown',
          count: 0,
          days: {}
        };
      }
      studentAbsentCount[studentId].count++;
      const dateStr = record.record_date.toISOString().split('T')[0];
      if (!studentAbsentCount[studentId].days[dateStr]) {
        studentAbsentCount[studentId].days[dateStr] = 0;
      }
      studentAbsentCount[studentId].days[dateStr]++;
    });
    
    for (const [studentId, data] of Object.entries(studentAbsentCount)) {
      console.log(`${data.name} (ID: ${studentId}): ${data.count} total absents`);
      for (const [date, count] of Object.entries(data.days)) {
        console.log(`  ${date}: ${count} absents`);
      }
    }
    
    console.log('\n=== Check Warnings ===\n');
    
    const warnings = await prisma.warnings.findMany({
      include: { student_profiles: { include: { users: true } } },
      orderBy: { created_at: 'desc' },
      take: 30
    });
    
    console.log(`Recent ${warnings.length} warnings:\n`);
    warnings.forEach(w =&gt; {
      console.log(`${w.id} | ${w.level} | ${w.metric} | ${w.window} | ${w.student_profiles?.users?.name || 'Unknown'} | ${w.status}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkWarningRules();
