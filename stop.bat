@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

REM WARNSYS One-Click Stop (delegates to stop.ps1)
REM Options: -KeepDocker | -NoPause

set "NEED_PAUSE=1"
for %%A in (%*) do (
  if /I "%%~A"=="-NoPause" set "NEED_PAUSE=0"
  if /I "%%~A"=="--no-pause" set "NEED_PAUSE=0"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if "%NEED_PAUSE%"=="1" (
  echo.
  pause
)
exit /b %EXIT_CODE%
