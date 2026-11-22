<#
  学业预警系统 · 一键关闭脚本 (Windows PowerShell)

  作用：
    1. 终止由 start.bat 启动的本地后端与前端进程（含子进程树），并清理本项目端口残留 Node 进程
    2. 关闭本项目 Docker Compose 容器
       - 默认：docker compose stop（保留容器与网络，下次 start 秒起）
       - -Purge：docker compose down --remove-orphans（删除容器与网络，数据卷始终保留）
       - -KeepDocker：完全不碰 Docker，只停本地进程

  用法：
    .\stop.bat
    .\stop.bat -Purge
    .\stop.bat -KeepDocker
    .\stop.bat -NoPause
#>
[CmdletBinding()]
param(
  [switch]$KeepDocker,
  [switch]$Purge,
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

# 2) 兜底清理残留 Node 进程（只认本项目特征，避免误伤其它项目）：
#    a) 命令行里直接出现本项目根目录 —— 一定是本项目的
#    b) 相对路径启动的 vite（node_modules/vite/bin/vite.js）且确实在监听 5173
#    c) dist/main.js 或 dist/worker.js 且确实在监听 3000
$rootPattern = [Regex]::Escape($PSScriptRoot)

function Test-ListenOnPort($procId, $port) {
  $conn = Get-NetTCPConnection -OwningProcess $procId -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $port }
  return [bool]$conn
}

$strayNodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $cmd = [string]$_.CommandLine
  if (-not $cmd) { return $false }
  if ($cmd -match $rootPattern) { return $true }
  if ($cmd -match 'vite(\.js|/bin/vite)' -and (Test-ListenOnPort $_.ProcessId 5173)) { return $true }
  if ($cmd -match 'dist[\\/](main|worker)\.js' -and (Test-ListenOnPort $_.ProcessId 3000)) { return $true }
  return $false
}
foreach ($proc in $strayNodes) {
  Stop-ProcessTree ([int]$proc.ProcessId) "残留 Node 进程 ($($proc.ProcessId))"
}
if (-not $strayNodes) {
  Write-Step '未发现本项目残留 Node 进程。'
}

# 3) 处理 Docker
if ($KeepDocker) {
  Write-Step '已指定 -KeepDocker，保留 Docker 容器运行。'
} else {
  $null = & cmd /c "docker info >nul 2>&1"
  if ($LASTEXITCODE -eq 0) {
    if ($Purge) {
      Write-Step '正在删除项目 Docker 容器与网络（数据卷保留）...'
      docker compose down --remove-orphans
      if ($LASTEXITCODE -eq 0) {
        Write-Ok 'Docker 容器已删除，数据卷已保留：'
        docker volume ls --filter name=warnsys --format '   {{.Name}}'
      } else {
        Write-Warn 'docker compose down 返回非零状态，请检查容器状态。'
      }
    } else {
      Write-Step '正在停止项目 Docker 容器（保留容器与数据卷，下次启动更快）...'
      docker compose stop
      if ($LASTEXITCODE -eq 0) {
        Write-Ok 'Docker 容器已停止，数据卷已保留：'
        docker volume ls --filter name=warnsys --format '   {{.Name}}'
      } else {
        Write-Warn 'docker compose stop 返回非零状态，请检查容器状态。'
      }
    }
  } else {
    Write-Warn 'Docker 引擎当前未运行，已跳过容器关闭步骤。'
  }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' [OK] 学业预警系统已关闭' -ForegroundColor Green
Write-Host '   重新启动： .\start.bat' -ForegroundColor Green
Write-Host '   彻底清容器： .\stop.bat -Purge  （数据卷仍保留）' -ForegroundColor DarkGray
Write-Host '============================================================' -ForegroundColor Green
