# Wait for auto-close to persist absences, then assert counts.
# Windows PowerShell 5.1 reads .ps1 as ANSI -> keep this file ASCII-only.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\loadtest_watch.ps1

$ErrorActionPreference = 'Continue'

$target = 2000
$startedAt = Get-Date

function Q([string]$sql) {
  $out = $sql | docker exec -i warnsys-mysql mysql -uroot -p$env:MYSQL_ROOT_PASSWORD --default-character-set=utf8mb4 -N -B warnsys 2>$null
  return $out
}

Write-Host "waiting for auto-close: target absent=$target"
$last = -1
while (((Get-Date) - $startedAt).TotalSeconds -lt 150) {
  $sql = "SELECT COUNT(*) FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' AND ar.attendance_status='absent';"
  $raw = Q $sql | Select-Object -First 1
  $absent = 0
  [void][int]::TryParse([string]$raw, [ref]$absent)
  if ($absent -ne $last) {
    Write-Host ("  t+{0,6:N1}s absent={1}" -f ((Get-Date) - $startedAt).TotalSeconds, $absent)
    $last = $absent
  }
  if ($absent -ge $target) { break }
  Start-Sleep -Milliseconds 200
}
Write-Host ("elapsed {0:N1}s" -f ((Get-Date) - $startedAt).TotalSeconds)

$report = "SELECT '1_ontime' k, CAST(COUNT(*) AS CHAR) v FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' AND ar.attendance_status='on_time' " +
"UNION ALL SELECT '2_absent', CAST(COUNT(*) AS CHAR) FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' AND ar.attendance_status='absent' " +
"UNION ALL SELECT '3_total', CAST(COUNT(*) AS CHAR) FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' " +
"UNION ALL SELECT '4_dup', CAST(COUNT(*) AS CHAR) FROM (SELECT ar.session_id, ar.student_id FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' GROUP BY ar.session_id, ar.student_id HAVING COUNT(*)>1) d " +
"UNION ALL SELECT '5_ended', CAST(COUNT(*) AS CHAR) FROM class_sessions s JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' AND s.status='ended' " +
"UNION ALL SELECT '6_last_latency_ms', CAST(ROUND(TIMESTAMPDIFF(MICROSECOND, MIN(s.session_end), MAX(ar.created_at))/1000,1) AS CHAR) FROM attendance_records ar JOIN class_sessions s ON s.id=ar.session_id JOIN classes c ON c.id=s.class_id WHERE c.class_name LIKE 'LOADTEST-%' AND ar.attendance_status='absent' " +
"UNION ALL SELECT '7_daily_absent', CAST(COUNT(*) AS CHAR) FROM daily_records d JOIN classes c ON c.id=d.class_id WHERE c.class_name LIKE 'LOADTEST-%' AND d.attendance_status='absent';"

Q $report | ForEach-Object { $_ }
