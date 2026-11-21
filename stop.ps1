<#
  学业预警系统 · 一键关闭脚本 (Windows PowerShell)

  作用：
    1. 终止由 start.bat 启动的本地后端与前端进程（含子进程树），并清理本项目端口残留 Node 进程
    2. 停止并移除本项目 Docker Compose 容器（保留 MySQL / Redis / MinIO 数据卷）
#>
[CmdletBinding()]
param(
  [switch]$KeepDocker,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

function Write-Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

function Stop-ProcessTree($procId, $label) {
  if (-not $procId -or $procId -le 0) { return }
  $existing = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $existing) { return }
  $null = & taskkill /PID $procId /T /F 2>&1
  Write-Ok "已停止 $label (PID $procId)"
}

# 1) 根据 PID 记录关闭本地前后端
$pidFile = Join-Path $PSScriptRoot '.tmp-warnsys-pids.json'
if (Test-Path $pidFile) {
  Write-Step '正在停止本地后端与前端进程...'
  try {
    $rec = Get-Content -Path $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($rec.backendPid)  { Stop-ProcessTree ([int]$rec.backendPid) '本地后端' }
    if ($rec.frontendPid) { Stop-ProcessTree ([int]$rec.frontendPid) '本地前端' }
  } catch {
    Write-Warn "读取 PID 文件异常: $($_.Exception.Message)"
  }
  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

# 2) 按当前仓库路径精确兜底清理可能残留的本地 Node 进程（不误伤其它项目进程）
$rootPattern = [Regex]::Escape($PSScriptRoot)
$strayNodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and (
    ($_.CommandLine -match $rootPattern) -or
    ($_.CommandLine -match 'dist[\\/]main\.js' -and (Get-NetTCPConnection -OwningProcess $_.ProcessId -LocalPort 3000 -ErrorAction SilentlyContinue)) -or
    ($_.CommandLine -match 'vite\.js' -and (Get-NetTCPConnection -OwningProcess $_.ProcessId -LocalPort 5173 -ErrorAction SilentlyContinue))
  )
}
foreach ($proc in $strayNodes) {
  Stop-ProcessTree ([int]$proc.ProcessId) "残留 Node 进程 ($($proc.ProcessId))"
}

# 3) 停止 Docker Compose 容器（保留数据卷）
if (-not $KeepDocker) {
  $null = & cmd /c "docker info >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    Write-Step '正在停止项目 Docker 容器（保留 MySQL / Redis / MinIO 数据卷）...'
    docker compose down --remove-orphans
    if ($LASTEXITCODE -eq 0) {
      Write-Ok 'Docker 容器已全部停止，数据卷已保留：'
      docker volume ls --filter name=warnsys --format '   {{.Name}}'
    } else {
      Write-Warn 'docker compose down 返回非零状态，请检查容器状态。'
    }
  } else {
    Write-Warn 'Docker 引擎当前未运行，已跳过容器关闭步骤。'
  }
} else {
  Write-Step '已指定 -KeepDocker，保留 Docker 容器运行。'
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' [OK] 学业预警系统已关闭' -ForegroundColor Green
Write-Host '   重新启动： .\start.bat' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
