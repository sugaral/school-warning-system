<#
  学业预警系统 · 本地一键启动（Windows PowerShell 版）

  dev-up.sh 需要 bash（Git Bash / WSL）。本脚本是纯 PowerShell 等价实现，
  便于在 Windows 上直接使用，不依赖 bash。

  用法:
    .\dev-up.ps1              # 构建并启动，等待就绪后打印访问信息
    .\dev-up.ps1 -NoBuild     # 跳过构建
#>
[CmdletBinding()]
param(
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Fail($msg) { Write-Host "X $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "OK $msg" -ForegroundColor Green }

# ---------- 0. 前置检查 ----------
try { $null = docker version --format '{{.Server.Version}}' } catch { Fail 'Docker 未运行，请先启动 Docker Desktop' }

if (-not (Test-Path '.env')) {
    Info '未找到 .env，从 .env.example 生成'
    Copy-Item '.env.example' '.env'
}

function Get-EnvValue($key, $default) {
    $line = Select-String -Path '.env' -Pattern "^$key=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($line) { return ($line.Line -split '=', 2)[1].Trim() }
    return $default
}

# ---------- 1. 构建 ----------
if (-not $NoBuild) {
    Info '构建镜像（backend / frontend；worker 复用 backend 镜像）...'
    docker compose build backend frontend
    if ($LASTEXITCODE -ne 0) { Fail '镜像构建失败' }
} else {
    Info '跳过构建（-NoBuild）'
}

# ---------- 2. 启动 ----------
Info '启动全栈（依赖顺序由 healthcheck 条件保证）...'
docker compose up -d
if ($LASTEXITCODE -ne 0) { Fail 'docker compose up 失败' }

# ---------- 3. 等待 healthy ----------
Info '等待服务就绪（最多 300 秒）...'
$deadline = (Get-Date).AddSeconds(300)
while ($true) {
    $rows = docker compose ps --format '{{.Name}}|{{.State}}|{{.Health}}' 2>$null
    $pending = @()
    foreach ($r in $rows) {
        $parts = $r -split '\|'
        if ($parts.Count -lt 2) { continue }
        $name = $parts[0]; $state = $parts[1]; $health = if ($parts.Count -ge 3) { $parts[2] } else { '' }
        if ($state -eq 'running' -and $health -ne '' -and $health -ne 'healthy') { $pending += $name }
        elseif ($state -ne 'running' -and $state -ne 'exited') { $pending += $name }
    }
    if ($pending.Count -eq 0) { break }
    if ((Get-Date) -ge $deadline) {
        Write-Host "! 等待超时，未就绪：$($pending -join ', ')" -ForegroundColor Yellow
        docker compose ps
        Write-Host '  查看日志： docker compose logs --tail=80 backend worker' -ForegroundColor Yellow
        exit 1
    }
    Start-Sleep -Seconds 3
}

# ---------- 4. 汇总 ----------
$frontendPort = Get-EnvValue 'FRONTEND_PORT' '8080'
$backendPort  = Get-EnvValue 'BACKEND_PORT' '3000'
$minioPort    = Get-EnvValue 'MINIO_CONSOLE_PORT' '9101'
$adminerPort  = Get-EnvValue 'ADMINER_PORT' '8081'

Write-Host ''
Write-Host '============================================================'
Write-Host ' 学业预警系统已启动' -ForegroundColor Green
Write-Host '============================================================'
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
Write-Host ''
Write-Host ' 访问地址'
Write-Host "   管理端（前端）   http://localhost:$frontendPort"
Write-Host "   后端 API         http://localhost:$backendPort"
Write-Host "   接口文档         http://localhost:$backendPort/doc.html"
Write-Host "   健康检查         http://localhost:$backendPort/health"
Write-Host "   MinIO 控制台     http://localhost:$minioPort"
Write-Host "   Adminer(DB)      http://localhost:$adminerPort"
Write-Host ''
Write-Host ' 默认账号（生产环境务必立即修改）'
Write-Host '   系统管理员       13800138000 / admin123'
Write-Host '   班主任           13800138001 / teacher123'
Write-Host '   学工             13800138003 / staff123'
Write-Host '   学生（示例）     20230003    / Student@2026'
Write-Host ''
Write-Host ' 常用命令'
Write-Host '   查看日志         docker compose logs -f backend worker'
Write-Host '   停止（保留数据） .\dev-down.ps1'
Write-Host '   清库重建         .\dev-reset.ps1'
Write-Host '============================================================'
