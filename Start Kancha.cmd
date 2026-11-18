@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 24 LTS before opening Kancha. & pause & exit /b 1)
if not exist "node_modules\@modelcontextprotocol\sdk\package.json" (
  call npm ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (pause & exit /b 1)
)
node src\cli.js dashboard --open --notify
if errorlevel 1 pause
