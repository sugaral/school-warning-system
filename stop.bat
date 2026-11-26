@echo off
chcp 65001 >nul
setlocal
set "NO_PAUSE=0"
for %%A in (%*) do (
    if /i "%%~A"=="--no-pause" set "NO_PAUSE=1"
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%NO_PAUSE%"=="0" (
    echo %cmdcmdline% | find /i "/c" >nul && pause
)
exit /b %EXIT_CODE%
