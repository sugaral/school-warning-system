<#
  学业预警系统 · 停止（Windows PowerShell 版）
  作用：停止并移除容器，**保留数据卷**
  用法: .\dev-down.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '-> 停止并移除容器（保留数据卷）...' -ForegroundColor Cyan
docker compose down --remove-orphans

Write-Host ''
Write-Host 'OK 已停止。数据卷仍保留：' -ForegroundColor Green
docker volume ls --filter name=warnsys --format '   {{.Name}}'
Write-Host ''
Write-Host '   重新启动： .\dev-up.ps1 -NoBuild'
Write-Host '   清库重建： .\dev-reset.ps1'
