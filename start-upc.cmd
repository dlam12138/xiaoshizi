@echo off
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo Build missing. Run npm ci and npm run build first.
  pause
  exit /b 1
)
call npm run preview -- --host 127.0.0.1 --port 3000 --strictPort
