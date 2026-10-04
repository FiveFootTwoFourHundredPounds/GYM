@echo off
cd /d "%~dp0"
start "" /B ollama serve
timeout /t 3 >nul
node server.js
pause
