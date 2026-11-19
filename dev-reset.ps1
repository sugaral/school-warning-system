<#
  学业预警系统 · 清库重建（Windows PowerShell 版）

  作用：down -v 删除全部数据卷 -> 重新构建 -> 重新 db push + seed
  警告：**会永久删除所有数据**（学生/成绩/预警/上传文件）

  用法:
    .\dev-reset.ps1          # 二次确认
    .\dev-reset.ps1 -Yes     # 跳过确认（供 CI / 自测脚本使用）
#>
[CmdletBinding()]
param([switch]$Yes)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Fail($msg) { Write-Host "X $msg" -ForegroundColor Red; exit 1 }

if (-not $Yes) {
    Write-Host '! 该操作会删除全部数据卷（数据库、Redis、MinIO 文件），且不可恢复。' -ForegroundColor Yellow
    $ans = Read-Host '  确认继续？输入 yes 继续'
    if ($ans -ne 'yes') { Write-Host '已取消'; exit 0 }
}

Write-Host '-> 停止并删除数据卷...' -ForegroundColor Cyan
docker compose down -v --remove-orphans

Write-Host '-> 重新构建镜像...' -ForegroundColor Cyan
docker compose build backend frontend
if ($LASTEXITCODE -ne 0) { Fail '镜像构建失败' }

Write-Host '-> 重新启动（migrate 容器会执行 db push + seed）...' -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up 失败' }

Write-Host '-> 等待就绪...' -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(300)
while ($true) {
    $rows = docker compose ps --format '{{.Name}}|{{.State}}|{{.Health}}' 2>$null
    $pending = @()
    foreach ($r in $rows) {
        $parts = $r -split '\|'
        if ($parts.Count -lt 2) { continue }
        $state = $parts[1]; $health = if ($parts.Count -ge 3) { $parts[2] } else { '' }
        if ($state -eq 'running' -and $health -ne '' -and $health -ne 'healthy') { $pending += $parts[0] }
    }
    if ($pending.Count -eq 0) { break }
    if ((Get-Date) -ge $deadline) {
        Write-Host '! 等待超时' -ForegroundColor Yellow
        docker compose ps
        exit 1
    }
    Start-Sleep -Seconds 3
}

Write-Host ''
Write-Host '-> 校验 seed 结果（关键表行数，均应为非 0）...' -ForegroundColor Cyan
docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -D "$MYSQL_DATABASE" -N -e "SELECT ''users'', COUNT(*) FROM users UNION ALL SELECT ''classes'', COUNT(*) FROM classes UNION ALL SELECT ''student_profiles'', COUNT(*) FROM student_profiles UNION ALL SELECT ''courses'', COUNT(*) FROM courses UNION ALL SELECT ''warning_rules'', COUNT(*) FROM warning_rules;" 2>/dev/null'

Write-Host ''
Write-Host 'OK 已重置为干净状态。访问： http://localhost:8080' -ForegroundColor Green
Write-Host '   提示：演示用的历史考勤/成绩数据（预警引擎需要）可执行：'
Write-Host '         docker compose exec backend npx ts-node prisma/seed-demo-history.ts'
