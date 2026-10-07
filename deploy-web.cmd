@echo off
rem Launcher only. All logic lives in work\deploy-web.js
chcp 65001 >nul 2>&1
cd /d "%~dp0"
node "work\deploy-web.js"
echo.
pause
