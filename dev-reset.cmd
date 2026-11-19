@echo off
REM 学业预警系统 · 清库重建（删除全部数据）
REM 用 -ExecutionPolicy Bypass 只对本次调用放行，不修改系统全局策略。
setlocal
cd /d "%~dp0"
REM 切到 UTF-8 代码页，避免中文输出在 cmd 重定向时乱码
chcp 65001 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-reset.ps1" %*
exit /b %ERRORLEVEL%
