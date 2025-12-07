@echo off
echo 🚀 Starting Watchlight - API Observability Mesh
echo.

REM Check if .env exists
if not exist .env (
    echo ❌ .env file not found!
    echo    Please copy infra/env.example to .env and configure it.
    pause
    exit /b 1
)

echo 📦 Starting services...
echo.

REM Start each service in a new window
start "Gateway" cmd /k "cd gateway && npm run dev"
timeout /t 1 /nobreak >nul

start "Logs Service" cmd /k "cd logs-service && npm run dev"
timeout /t 1 /nobreak >nul

start "Metrics Service" cmd /k "cd metrics-service && npm run dev"
timeout /t 1 /nobreak >nul

start "Trace Service" cmd /k "cd trace-service && npm run dev"
timeout /t 1 /nobreak >nul

start "AI Analyzer" cmd /k "cd ai-analyzer && npm run dev"
timeout /t 1 /nobreak >nul

start "Notify Service" cmd /k "cd notify-service && npm run dev"

echo.
echo ✅ All services started in separate windows
echo.
echo 💡 Tip: Close individual windows to stop specific services
pause

