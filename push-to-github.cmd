@echo off
rem Launcher only. All logic lives in work\push-to-github.js
chcp 65001 >nul 2>&1
cd /d "%~dp0"
node "work\push-to-github.js"
echo.
pause
