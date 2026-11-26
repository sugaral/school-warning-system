[CmdletBinding()]
param(
    [switch]$KeepInfra,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
$WebPidFile = Join-Path $ScriptDir '.web.pid'
$InfraContainers = @('warnsys-minio', 'warnsys-redis', 'warnsys-mysql')

function Write-Step([string]$Msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Msg" -ForegroundColor Cyan
}

function Write-Ok([string]$Msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [OK] $Msg" -ForegroundColor Green
}

Write-Host '============================================================' -ForegroundColor White
Write-Host '        Snowy 学业预警系统 - 一键关闭脚本' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White

# 1. 关闭管理端前端 (:81)
Write-Step '1/3 关闭管理端前端 snowy-admin-web (端口 81)...'
$stoppedPids = New-Object System.Collections.Generic.HashSet[int]

if (Test-Path $WebPidFile) {
    $rawPid = (Get-Content -Path $WebPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $savedPid = 0
    if ($rawPid -and [int]::TryParse($rawPid.Trim(), [ref]$savedPid) -and $savedPid -gt 0) {
        if (Get-Process -Id $savedPid -ErrorAction SilentlyContinue) {
            & taskkill.exe /PID $savedPid /T /F *> $null
            [void]$stoppedPids.Add($savedPid)
        }
    }
    Remove-Item -Path $WebPidFile -Force -ErrorAction SilentlyContinue
}

$port81Pids = @(Get-NetTCPConnection -LocalPort 81 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($p in $port81Pids) {
    if ($p -gt 0 -and -not $stoppedPids.Contains($p)) {
        & taskkill.exe /PID $p /T /F *> $null
        [void]$stoppedPids.Add($p)
    }
}

Start-Sleep -Milliseconds 500
$leftover81 = Get-NetTCPConnection -LocalPort 81 -State Listen -ErrorAction SilentlyContinue
if (-not $leftover81) {
    Write-Ok "前端服务已关闭 (清理进程数: $($stoppedPids.Count))"
} else {
    Write-Host '[警告] 端口 81 仍有监听连接，请手动检查。' -ForegroundColor Yellow
}

# 2. 关闭后端容器 snowy-backend
Write-Step '2/3 关闭后端服务 snowy-backend (端口 82)...'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host '[警告] Docker 引擎未运行，跳过容器关闭。' -ForegroundColor Yellow
    exit 0
}

$backendRunning = (docker inspect -f '{{.State.Running}}' snowy-backend 2>$null)
if ($backendRunning -eq 'true') {
    docker stop snowy-backend | Out-Null
    Write-Ok '容器 snowy-backend 已停止'
} else {
    Write-Ok '容器 snowy-backend 未在运行'
}

# 3. 关闭基础中间件容器 (保留数据卷，不使用 docker rm)
if ($KeepInfra) {
    Write-Ok '3/3 已指定 -KeepInfra，保留 MySQL / Redis / MinIO 继续运行'
} else {
    Write-Step '3/3 关闭基础设施容器 (MinIO / Redis / MySQL)...'
    foreach ($c in $InfraContainers) {
        $running = (docker inspect -f '{{.State.Running}}' $c 2>$null)
        if ($running -eq 'true') {
            docker stop $c | Out-Null
            Write-Ok "容器 $c 已停止"
        } else {
            Write-Ok "容器 $c 未在运行"
        }
    }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '                 系统服务已安全关闭!' -ForegroundColor Green
Write-Host '  (所有容器与 MySQL / MinIO / Redis 数据卷均已完整保留)' -ForegroundColor Gray
Write-Host '============================================================' -ForegroundColor Green
exit 0
