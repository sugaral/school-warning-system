@echo off
REM ============================================================
REM  学业预警系统 · 一键启动（Windows 包装脚本）
REM ------------------------------------------------------------
REM  为什么需要这个 .cmd：
REM    默认的 PowerShell 执行策略（Restricted）会直接拒绝运行 .ps1，
REM    报 "running scripts is disabled on this system"（本机实测如此）。
REM    本包装脚本用 -ExecutionPolicy Bypass 只对本次调用放行，
REM    不修改系统全局策略，直接双击或命令行执行即可。
REM
REM  用法:  dev-up.cmd            构建并启动
REM         dev-up.cmd -NoBuild   跳过构建
REM ============================================================
setlocal
cd /d "%~dp0"
REM 切到 UTF-8 代码页，避免中文输出在 cmd 里变成乱码
REM （实测：不切换时，重定向到文件的中文会因 ANSI 代码页而损坏）
chcp 65001 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-up.ps1" %*
exit /b %ERRORLEVEL%
