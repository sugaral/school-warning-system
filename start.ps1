<#
  学业预警系统 · 一键启动脚本 (Windows PowerShell)

  默认模式（混合极速）：Docker 基础依赖 (mysql/redis/minio/minio-init) + 本地后端 + 本地前端
  全栈模式（-Docker）：Docker Compose 全容器启动
#>
[CmdletBinding()]
param(
  [switch]$Docker,
  [switch]$Rebuild,
  [switch]$Dev,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

function Write-Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail-Exit($msg)  { Write-Host "[X] $msg" -ForegroundColor Red; exit 1 }

function Get-EnvValue($key, $defaultVal) {
  if (-not (Test-Path '.env')) { return $defaultVal }
  $line = Select-String -Path '.env' -Pattern "^$key=" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($line) {
    $val = ($line.Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if ($val -ne '') { return $val }
  }
  return $defaultVal
}

function Test-DockerReady {
  $null = & cmd /c "docker info >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

function Ensure-DockerRunning {
  if (Test-DockerReady) {
    Write-Ok 'Docker 引擎已就绪'
    return
  }

  $candidates = @(
    'E:\docker\Docker Desktop.exe',
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe')
  )
  $dockerExe = $null
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) {
      $dockerExe = $c
      break
    }
  }

  if (-not $dockerExe) {
    Fail-Exit 'Docker 引擎未运行，且未找到 Docker Desktop 可执行文件，请手动启动 Docker Desktop 后重试。'
  }

  Write-Step "Docker 引擎未运行，正在启动 Docker Desktop ($dockerExe)..."
  Start-Process -FilePath $dockerExe | Out-Null

  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) {
      Write-Ok 'Docker 引擎已启动就绪'
      return
    }
  }
  Fail-Exit '等待 Docker 引擎就绪超时（120 秒），请检查 Docker Desktop 状态。'
}

function Wait-ComposeServices($names, $timeoutSeconds) {
  Write-Step "等待容器健康就绪: $($names -join ', ') ..."
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $allOk = $true
    foreach ($name in $names) {
      $status = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $name 2>$null)
      if ($LASTEXITCODE -ne 0 -or (-not $status)) {
        $allOk = $false
        break
      }
      $s = $status.Trim()
      if ($s -ne 'healthy' -and $s -ne 'running') {
        $allOk = $false
        break
      }
    }
    if ($allOk) {
      Write-Ok '所需容器全部就绪'
      return
    }
    Start-Sleep -Seconds 2
  }
  docker compose ps
  Fail-Exit '容器健康检查超时，请运行 docker compose logs 查看原因。'
}

function Test-HttpReady($url) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 -ErrorAction Stop
    return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
  } catch {
    return $false
  }
}

function Wait-HttpReady($url, $label, $timeoutSeconds, $proc) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($proc -and $proc.HasExited) {
      return $false
    }
    if (Test-HttpReady $url) {
      Write-Ok "$label 已就绪 ($url)"
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-ListeningPid($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { return [int]$conn.OwningProcess }
  return $null
}

# ---------- 0. 环境配置 ----------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail-Exit '未检测到 docker 命令，请先安装 Docker Desktop。'
}
if (-not (Test-Path '.env')) {
  Write-Step '未找到 .env，从 .env.example 复制生成'
  Copy-Item '.env.example' '.env'
}

# 唯一配置源是根目录 .env。Prisma CLI 只会读 backend/.env，所以在这里建一个
# **硬链接**（不是副本）：两边指向同一份内容，改任一处都同步，不会再出现
# “两份 .env 值不一致”的问题。
function Ensure-BackendEnvLink {
  $rootEnv = Join-Path $PSScriptRoot '.env'
  $backendEnv = Join-Path $PSScriptRoot 'backend\.env'
  if (-not (Test-Path $rootEnv)) { return }
  if (Test-Path $backendEnv) { return }

  $null = & cmd /c "mklink /H `"$backendEnv`" `"$rootEnv`"" 2>&1
  if (-not (Test-Path $backendEnv)) {
    Copy-Item $rootEnv $backendEnv
    Write-Warn '无法创建 backend/.env 硬链接，已退化为复制；请勿单独修改该副本。'
  }
}
Ensure-BackendEnvLink

$backendPort = [int](Get-EnvValue 'BACKEND_PORT' '3000')
$dockerFrontendPort = [int](Get-EnvValue 'FRONTEND_PORT' '8080')
$mysqlPort = Get-EnvValue 'MYSQL_PORT' '3307'
$redisPort = Get-EnvValue 'REDIS_PORT' '6380'
$minioConsolePort = Get-EnvValue 'MINIO_CONSOLE_PORT' '9101'
$vitePort = 5173

Ensure-DockerRunning

# ---------- 分支 A: Docker 全栈模式 ----------
if ($Docker) {
  Write-Step '当前模式：Docker Compose 全栈模式'
  if (Test-Path (Join-Path $PSScriptRoot 'stop.ps1')) {
    & (Join-Path $PSScriptRoot 'stop.ps1') -KeepDocker -NoPause | Out-Null
  }

  if ($Rebuild) {
    Write-Step '重新构建前后端镜像...'
    docker compose build backend frontend
    if ($LASTEXITCODE -ne 0) { Fail-Exit 'Docker 镜像构建失败' }
  }

  Write-Step '启动 Docker Compose 全栈...'
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Fail-Exit 'docker compose up 失败' }

  Wait-ComposeServices @('warnsys-mysql', 'warnsys-redis', 'warnsys-minio', 'warnsys-backend', 'warnsys-worker', 'warnsys-frontend') 300

  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Green
  Write-Host ' 学业预警系统（Docker 全栈模式）已启动' -ForegroundColor Green
  Write-Host '============================================================' -ForegroundColor Green
  Write-Host "   管理端（Web）    http://127.0.0.1:$dockerFrontendPort"
  Write-Host "   后端 API         http://127.0.0.1:$backendPort/health"
  Write-Host "   MinIO 控制台     http://127.0.0.1:$minioConsolePort"
  Write-Host "   一键关闭         .\stop.bat"
  Write-Host '============================================================' -ForegroundColor Green
  exit 0
}

# ---------- 分支 B: 默认本地极速模式 ----------
Write-Step '当前模式：本地联调极速模式（Docker 基础依赖 + 本地前后端）'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail-Exit '未检测到 node，请安装 Node.js 20+ 或改用 .\start.bat -Docker。'
}

Write-Step '1/4 启动基础依赖容器 (MySQL / Redis / MinIO)...'
docker compose up -d mysql redis minio minio-init
if ($LASTEXITCODE -ne 0) { Fail-Exit '基础依赖容器启动失败' }
Wait-ComposeServices @('warnsys-mysql', 'warnsys-redis', 'warnsys-minio') 180

# 确保前后端依赖就绪
if (-not (Test-Path 'backend\node_modules')) {
  Write-Step '首次安装后端依赖 (backend/node_modules)...'
  Push-Location backend
  npm install
  $ec = $LASTEXITCODE
  Pop-Location
  if ($ec -ne 0) { Fail-Exit '后端 npm install 失败' }
}
if (-not (Test-Path 'admin-frontend\node_modules')) {
  Write-Step '首次安装前端依赖 (admin-frontend/node_modules)...'
  Push-Location admin-frontend
  npm install
  $ec = $LASTEXITCODE
  Pop-Location
  if ($ec -ne 0) { Fail-Exit '前端 npm install 失败' }
}

# 构建检查
$needPrisma = (-not (Test-Path 'backend\node_modules\.prisma\client')) -or $Rebuild
$needBuild = (-not (Test-Path 'backend\dist\main.js')) -or $Rebuild
if ($needPrisma -or $needBuild) {
  Write-Step '2/4 生成 Prisma Client 并编译后端...'
  Push-Location backend
  if ($needPrisma) {
    npx prisma generate
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail-Exit 'prisma generate 失败' }
  }
  if ($needBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail-Exit '后端编译失败' }
  }
  Pop-Location
} else {
  Write-Step '2/4 后端构建产物已存在，跳过重复编译（加 -Rebuild 可强制重编）'
}

if ($Rebuild -and (Test-Path '.tmp-warnsys-pids.json')) {
  Write-Step '检测到 -Rebuild，先关闭旧的本地服务...'
  & (Join-Path $PSScriptRoot 'stop.ps1') -KeepDocker -NoPause | Out-Null
}

$logDir = Join-Path $PSScriptRoot '.tmp-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$pidFile = Join-Path $PSScriptRoot '.tmp-warnsys-pids.json'

$existingPidData = @{}
if (Test-Path $pidFile) {
  try {
    $rawPidJson = Get-Content -Path $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($rawPidJson.backendPid)  { $existingPidData.backendPid = [int]$rawPidJson.backendPid }
    if ($rawPidJson.frontendPid) { $existingPidData.frontendPid = [int]$rawPidJson.frontendPid }
  } catch { }
}

# ---------- 启动后端 ----------
$backendProc = $null
$finalBackendPid = $null
$listenBackendPid = Get-ListeningPid $backendPort
if ($listenBackendPid) {
  if (Test-HttpReady "http://127.0.0.1:$backendPort/health") {
    Write-Ok "3/4 后端已在运行 (PID $listenBackendPid, 端口 $backendPort)"
    $finalBackendPid = $listenBackendPid
  } else {
    Fail-Exit "端口 $backendPort 已被 PID $listenBackendPid 占用且健康检查未通过，请先运行 .\stop.bat 或排查占用。"
  }
} else {
  Write-Step "3/4 启动本地后端服务 (端口 $backendPort)..."
  $beOut = Join-Path $logDir 'backend.log'
  $beErr = Join-Path $logDir 'backend.err.log'
  if ($Dev) {
    $backendProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run start:dev' `
      -WorkingDirectory (Join-Path $PSScriptRoot 'backend') `
      -RedirectStandardOutput $beOut -RedirectStandardError $beErr `
      -WindowStyle Hidden -PassThru
  } else {
    $backendProc = Start-Process -FilePath 'node' -ArgumentList 'dist/main.js' `
      -WorkingDirectory (Join-Path $PSScriptRoot 'backend') `
      -RedirectStandardOutput $beOut -RedirectStandardError $beErr `
      -WindowStyle Hidden -PassThru
  }
  $finalBackendPid = $backendProc.Id
  $beReady = Wait-HttpReady "http://127.0.0.1:$backendPort/health" '后端 API' 60 $backendProc
  if (-not $beReady) {
    Write-Warn '后端启动失败，最近错误日志：'
    if (Test-Path $beErr) { Get-Content $beErr -Tail 30 }
    if (Test-Path $beOut) { Get-Content $beOut -Tail 30 }
    Fail-Exit '后端未能通过 /health 健康检查。'
  }
}

# ---------- 启动前端 ----------
$frontendProc = $null
$finalFrontendPid = $null
$listenFrontendPid = Get-ListeningPid $vitePort
if ($listenFrontendPid) {
  Write-Ok "4/4 前端已在运行 (PID $listenFrontendPid, 端口 $vitePort)"
  $finalFrontendPid = $listenFrontendPid
} else {
  Write-Step "4/4 启动本地前端服务 (端口 $vitePort)..."
  $feOut = Join-Path $logDir 'frontend.log'
  $feErr = Join-Path $logDir 'frontend.err.log'
  $viteBin = Join-Path $PSScriptRoot 'admin-frontend\node_modules\vite\bin\vite.js'
  if (Test-Path $viteBin) {
    $frontendProc = Start-Process -FilePath 'node' `
      -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', "$vitePort") `
      -WorkingDirectory (Join-Path $PSScriptRoot 'admin-frontend') `
      -RedirectStandardOutput $feOut -RedirectStandardError $feErr `
      -WindowStyle Hidden -PassThru
  } else {
    $frontendProc = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/c', "npm run dev -- --host 127.0.0.1 --port $vitePort" `
      -WorkingDirectory (Join-Path $PSScriptRoot 'admin-frontend') `
      -RedirectStandardOutput $feOut -RedirectStandardError $feErr `
      -WindowStyle Hidden -PassThru
  }
  $finalFrontendPid = $frontendProc.Id
  $feReady = Wait-HttpReady "http://127.0.0.1:$vitePort" '管理端前端' 45 $frontendProc
  if (-not $feReady) {
    Write-Warn '前端启动失败，最近错误日志：'
    if (Test-Path $feErr) { Get-Content $feErr -Tail 30 }
    if (Test-Path $feOut) { Get-Content $feOut -Tail 30 }
    Fail-Exit '前端开发服务未能在 45 秒内就绪。'
  }
}

# ---------- 保存 PID 快照 ----------
$pidRecord = @{
  mode         = 'hybrid'
  backendPid   = $finalBackendPid
  frontendPid  = $finalFrontendPid
  backendPort  = $backendPort
  frontendPort = $vitePort
  startedAt    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
}
$pidRecord | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' [OK] 学业预警系统已全部启动就绪' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host "   管理端 Web       http://127.0.0.1:$vitePort"
Write-Host "   后端 API         http://127.0.0.1:$backendPort/health"
Write-Host "   小程序本地接口   http://localhost:$backendPort"
Write-Host "   MySQL            127.0.0.1:$mysqlPort"
Write-Host "   Redis            127.0.0.1:$redisPort"
Write-Host "   MinIO 控制台     http://127.0.0.1:$minioConsolePort"
Write-Host "   日志目录         .tmp-logs\"
Write-Host "   一键关闭         .\stop.bat"
Write-Host '============================================================' -ForegroundColor Green
