#!/usr/bin/env python3
import json
import os
import subprocess

OUT = '/www/wwwroot/cursor-x/test-results/role-discovery.json'
SQL = r'''
SELECT 'teacher_binding' AS kind, u.id AS user_id, u.mobile AS account, u.name, tcb.class_id AS scope_id, NULL AS initial_password
FROM teacher_course_bindings tcb
JOIN users u ON u.id = tcb.teacher_id
GROUP BY u.id, u.mobile, u.name, tcb.class_id
LIMIT 10;

SELECT 'head_teacher_role' AS kind, u.id AS user_id, u.mobile AS account, u.name, ur.scope_id AS scope_id, NULL AS initial_password
FROM user_roles ur
JOIN users u ON u.id = ur.user_id
WHERE ur.role = 'head_teacher'
LIMIT 10;

SELECT 'student_user' AS kind, u.id AS user_id, sp.student_no AS account, u.name, sp.class_id AS scope_id, sp.initial_password
FROM student_profiles sp
JOIN users u ON u.id = sp.user_id
LIMIT 10;

SELECT 'class_monitor_role' AS kind, u.id AS user_id, COALESCE(NULLIF(u.mobile,''), sp.student_no) AS account, u.name, ur.scope_id AS scope_id, sp.initial_password
FROM user_roles ur
JOIN users u ON u.id = ur.user_id
LEFT JOIN student_profiles sp ON sp.user_id = u.id
WHERE ur.role = 'class_monitor'
LIMIT 10;
'''

cmd = "docker exec -i warnsys-mysql mysql -uwarnuser -pwarnpass123 -D warnsys -B -N"
proc = subprocess.Popen(cmd, shell=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
out, err = proc.communicate(SQL)
result = {'exit_code': proc.returncode, 'stdout': out, 'stderr': err}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(OUT)
