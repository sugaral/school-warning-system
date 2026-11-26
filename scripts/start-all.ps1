[CmdletBinding()]
param(
    [switch]$RebuildJar,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptDir
$WebDir = Join-Path $ProjectRoot 'snowy-admin-web'
$JarPath = Join-Path $ProjectRoot 'snowy-web-app\target\snowy-web-app-3.0.0.jar'
$WebPidFile = Join-Path $ScriptDir '.web.pid'
$WebOutLog = Join-Path $ScriptDir 'web-dev.log'
$WebErrLog = Join-Path $ScriptDir 'web-dev.err.log'
$NetworkName = 'warnsys-school_default'
$InfraContainers = @('warnsys-mysql', 'warnsys-redis', 'warnsys-minio')

function Write-Step([string]$Msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Msg" -ForegroundColor Cyan
}

function Write-Ok([string]$Msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [OK] $Msg" -ForegroundColor Green
}

function Write-Warn([string]$Msg) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] [WARN] $Msg" -ForegroundColor Yellow
}

function Test-HttpReady([string]$Url, [int]$TimeoutSec = 2) {
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
    } catch {
        return $false
    }
}

function Test-PortListening([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conns -and @($conns).Count -gt 0)
    } catch {
        return $false
    }
}

function Get-LanIPv4 {
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.IPAddress -ne '127.0.0.1' -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback'
            } |
            Sort-Object -Property @{
                Expression = {
                    if ($_.InterfaceAlias -match 'WLAN|Wi-Fi') { 0 }
                    elseif ($_.InterfaceAlias -match 'Ethernet|以太网') { 1 }
                    else { 2 }
                }
            }
        if ($ips) {
            return ($ips | Select-Object -First 1 -ExpandProperty IPAddress)
        }
    } catch {}
    return $null
}

Write-Host '============================================================' -ForegroundColor White
Write-Host '        Snowy 学业预警系统 - 一键启动脚本' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor White

# 1. 检查 Docker Desktop 是否就绪
Write-Step '1/5 检查 Docker 运行状态...'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host '[错误] Docker 未启动或无法连接，请先启动 Docker Desktop 后重试。' -ForegroundColor Red
    exit 1
}
Write-Ok 'Docker 引擎连接正常'

# 2. 启动基础中间件容器 (MySQL / Redis / MinIO)
Write-Step '2/5 启动基础设施容器 (MySQL / Redis / MinIO)...'
foreach ($c in $InfraContainers) {
    $exists = (docker ps -a --filter "name=^/${c}$" --format '{{.Names}}' 2>$null)
    if (-not $exists) {
        Write-Host "[错误] 未找到基础容器 $c，请先确认 docker compose 初始化环境已完成。" -ForegroundColor Red
        exit 1
    }
    $running = (docker inspect -f '{{.State.Running}}' $c 2>$null)
    if ($running -ne 'true') {
        docker start $c | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[错误] 启动容器 $c 失败。" -ForegroundColor Red
            exit 1
        }
        Write-Ok "已启动容器 $c"
    } else {
        Write-Ok "容器 $c 已在运行"
    }
}

Write-Step '等待 MySQL / Redis / MinIO 健康检查通过...'
$infraReady = $false
for ($i = 0; $i -lt 30; $i++) {
    $allOk = $true
    foreach ($c in $InfraContainers) {
        $health = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $c 2>$null)
        if ($health -ne 'healthy' -and $health -ne 'running') {
            $allOk = $false
            break
        }
    }
    if ($allOk) {
        $infraReady = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $infraReady) {
    Write-Host '[错误] 基础容器等待健康检查超时，请检查 docker logs。' -ForegroundColor Red
    exit 1
}
Write-Ok '基础中间件 (MySQL:3307 / Redis:6380 / MinIO:9100) 全部就绪'

# 3. 检查/构建后端可执行 JAR
if ($RebuildJar -or -not (Test-Path $JarPath)) {
    Write-Step '3/5 正在通过 Maven 容器编译打包后端 (snowy-web-app-3.0.0.jar)...'
    $m2Dir = Join-Path $env:USERPROFILE '.m2'
    docker run --rm -v "${ProjectRoot}:/workspace" -v "${m2Dir}:/root/.m2" -w /workspace maven:3.9-eclipse-temurin-17 mvn install -DskipTests -T 1C
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $JarPath)) {
        Write-Host '[错误] Maven 打包失败，请检查编译日志。' -ForegroundColor Red
        exit 1
    }
    Write-Ok '后端 JAR 打包完成'
} else {
    Write-Ok "3/5 检测到现有后端 JAR: $JarPath"
}

# 4. 启动 snowy-backend 后端服务 (:82)
Write-Step '4/5 启动后端服务 snowy-backend (端口 82)...'
$backendExists = (docker ps -a --filter 'name=^/snowy-backend$' --format '{{.Names}}' 2>$null)
if ($backendExists) {
    $backendRunning = (docker inspect -f '{{.State.Running}}' snowy-backend 2>$null)
    if ($backendRunning -ne 'true') {
        docker start snowy-backend | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host '[错误] 启动已存在容器 snowy-backend 失败。' -ForegroundColor Red
            exit 1
        }
        Write-Ok '已启动容器 snowy-backend'
    } else {
        Write-Ok '容器 snowy-backend 已在运行'
    }
} else {
    docker run -d --name snowy-backend --network $NetworkName -p 82:82 -e TZ=Asia/Shanghai `
        -v "${ProjectRoot}:/workspace" -w /workspace eclipse-temurin:17-jre `
        java -jar /workspace/snowy-web-app/target/snowy-web-app-3.0.0.jar --spring.profiles.active=local `
        --spring.datasource.dynamic.datasource.master.url="jdbc:mysql://warnsys-mysql:3306/snowy?useUnicode=true&characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true&nullCatalogMeansCurrent=true&useInformationSchema=true&rewriteBatchedStatements=true" `
        --spring.data.redis.host=warnsys-redis --spring.data.redis.port=6379 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[错误] 创建并启动容器 snowy-backend 失败。' -ForegroundColor Red
        exit 1
    }
    Write-Ok '已创建并启动容器 snowy-backend'
}

Write-Step '等待后端接口 http://127.0.0.1:82 就绪...'
$backendReady = $false
for ($i = 0; $i -lt 45; $i++) {
    if (Test-HttpReady 'http://127.0.0.1:82/auth/b/getPicCaptcha' 2) {
        $backendReady = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $backendReady) {
    Write-Host '[错误] 后端端口 82 启动超时，最近日志如下：' -ForegroundColor Red
    docker logs --tail 30 snowy-backend
    exit 1
}
Write-Ok '后端服务 http://127.0.0.1:82 已就绪 (HTTP 200)'

# 5. 启动管理端前端 snowy-admin-web (:81)
Write-Step '5/5 启动管理端前端 snowy-admin-web (端口 81)...'
if (Test-PortListening 81) {
    Write-Ok '端口 81 已有前端服务在运行，跳过重复启动'
} else {
    if (-not (Test-Path (Join-Path $WebDir 'node_modules'))) {
        Write-Warn '未检测到 node_modules，正在执行 npm install...'
        Push-Location $WebDir
        try {
            & npm.cmd install
            if ($LASTEXITCODE -ne 0) {
                throw 'npm install 失败'
            }
        } finally {
            Pop-Location
        }
    }
    $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' `
        -WorkingDirectory $WebDir -WindowStyle Hidden `
        -RedirectStandardOutput $WebOutLog -RedirectStandardError $WebErrLog -PassThru
    Set-Content -Path $WebPidFile -Value $proc.Id -Encoding Ascii

    $webReady = $false
    for ($i = 0; $i -lt 25; $i++) {
        if (Test-HttpReady 'http://127.0.0.1:81/' 2) {
            $webReady = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $webReady) {
        Write-Host '[错误] 前端端口 81 启动超时，请查看 scripts\web-dev.log / web-dev.err.log。' -ForegroundColor Red
        exit 1
    }
    Write-Ok "管理端前端已启动 (PID=$($proc.Id))"
}

$lanIp = Get-LanIPv4
Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '                 全部服务启动完成!' -ForegroundColor Green
Write-Host '------------------------------------------------------------' -ForegroundColor Green
Write-Host '  Web 管理端 (本机) : http://127.0.0.1:81' -ForegroundColor White
if ($lanIp) {
    Write-Host "  Web 管理端 (局域网): http://${lanIp}:81" -ForegroundColor White
}
Write-Host '  后端 API   (本机) : http://127.0.0.1:82' -ForegroundColor White
if ($lanIp) {
    Write-Host "  小程序后端 (局域网): http://${lanIp}:82" -ForegroundColor White
}
Write-Host '  API 文档          : http://127.0.0.1:82/doc.html' -ForegroundColor White
Write-Host '  MinIO 控制台      : http://127.0.0.1:9101' -ForegroundColor White
Write-Host '  默认超管账号      : superAdmin / Snowy@2026!' -ForegroundColor Gray
Write-Host '  前端日志位置      : scripts\web-dev.log' -ForegroundColor Gray
Write-Host '============================================================' -ForegroundColor Green
exit 0
