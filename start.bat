@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

REM WARNSYS One-Click Start (delegates to start.ps1)
REM Options: -Docker | -Rebuild | -Dev | -NoPause

set "NEED_PAUSE=1"
for %%A in (%*) do (
  if /I "%%~A"=="-NoPause" set "NEED_PAUSE=0"
  if /I "%%~A"=="--no-pause" set "NEED_PAUSE=0"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if "%NEED_PAUSE%"=="1" (
  echo.
  pause
)
exit /b %EXIT_CODE%
