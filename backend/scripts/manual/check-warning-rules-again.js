
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkWarningRules() {
  console.log('=== 检查预警规则配置 ===\n');
  
  try {
    const rules = await prisma.warning_rules.findMany({
      orderBy: [{ metric: 'asc' }, { window: 'asc' }, { threshold: 'asc' }]
    });
    
    console.log(`找到 ${rules.length} 条预警规则：\n`);
    
    const metricGroups = {};
    rules.forEach(rule =&gt; {
      if (!metricGroups[rule.metric]) {
        metricGroups[rule.metric] = [];
      }
      metricGroups[rule.metric].push(rule);
    });
    
    for (const [metric, metricRules] of Object.entries(metricGroups)) {
      console.log(`\n📊 指标: ${metric}`);
      
      const windowGroups = {};
      metricRules.forEach(rule =&gt; {
        if (!windowGroups[rule.window]) {
          windowGroups[rule.window] = [];
        }
        windowGroups[rule.window].push(rule);
      });
      
      for (const [window, windowRules] of Object.entries(windowGroups)) {
        console.log(`  📅 窗口: ${window}`);
        windowRules.sort((a, b) =&gt; a.threshold - b.threshold).forEach(rule =&gt; {
          console.log(`    ${rule.level.padEnd(8)} | 阈值: ${rule.threshold} | 启用: ${rule.enabled} | ID: ${rule.id}`);
        });
      }
    }
    
    console.log('\n=== 检查学生缺勤记录 ===\n');
    
    const absentRecords = await prisma.daily_records.findMany({
      where: { attendance_status: 'absent' },
      include: { student_profiles: { include: { users: true } } },
      orderBy: { record_date: 'desc' },
      take: 20
    });
    
    console.log(`最近 ${absentRecords.length} 条缺勤记录：\n`);
    
    const studentAbsentCount = {};
    absentRecords.forEach(record =&gt; {
      const studentId = record.student_id.toString();
      if (!studentAbsentCount[studentId]) {
        studentAbsentCount[studentId] = {
          name: record.student_profiles?.users?.name || '未知',
          count: 0,
          records: []
        };
      }
      studentAbsentCount[studentId].count++;
      studentAbsentCount[studentId].records.push(record);
    });
    
    for (const [studentId, data] of Object.entries(studentAbsentCount)) {
      console.log(`👤 ${data.name} (ID: ${studentId}): ${data.count} 次缺勤`);
      
      const dates = [...new Set(data.records.map(r =&gt; r.record_date.toISOString().split('T')[0]))];
      dates.forEach(date =&gt; {
        const dayRecords = data.records.filter(r =&gt; r.record_date.toISOString().split('T')[0] === date);
        console.log(`  ${date}: ${dayRecords.length} 次缺勤`);
      });
    }
    
    console.log('\n=== 检查现有预警 ===\n');
    
    const warnings = await prisma.warnings.findMany({
      include: { student_profiles: { include: { users: true } } },
      orderBy: { created_at: 'desc' },
      take: 20
    });
    
    console.log(`最近 ${warnings.length} 条预警：\n`);
    warnings.forEach(w =&gt; {
      console.log(`${w.id.toString().padEnd(5)} | ${w.level.padEnd(8)} | ${w.metric.padEnd(12)} | ${w.window.padEnd(6)} | ${w.student_profiles?.users?.name || '未知'} | ${w.status}`);
    });
    
  } catch (error) {
    console.error('检查失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkWarningRules();
