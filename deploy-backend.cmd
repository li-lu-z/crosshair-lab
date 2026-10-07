@echo off
rem Launcher only. All logic lives in work\deploy-backend.js
rem (cmd.exe garbles UTF-8 batch files, and parsing JSON with for /f is unreliable)
chcp 65001 >nul 2>&1
cd /d "%~dp0"
node "work\deploy-backend.js"
echo.
pause
