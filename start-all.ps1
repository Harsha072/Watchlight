# PowerShell script to start all Watchlight services
# Usage: .\start-all.ps1

Write-Host "🚀 Starting Watchlight - API Observability Mesh" -ForegroundColor Green
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env file not found!" -ForegroundColor Red
    Write-Host "   Please copy infra/env.example to .env and configure it." -ForegroundColor Yellow
    exit 1
}

# Start services in separate windows
Write-Host "📦 Starting services..." -ForegroundColor Cyan
Write-Host ""

# Gateway
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd gateway; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 1

# Logs Service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd logs-service; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 1

# Metrics Service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd metrics-service; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 1

# Trace Service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd trace-service; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 1

# AI Analyzer
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd ai-analyzer; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 1

# Notify Service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd notify-service; npm run dev" -WindowStyle Normal

Write-Host "✅ All services started in separate windows" -ForegroundColor Green
Write-Host ""
Write-Host "💡 Tip: Close individual windows to stop specific services" -ForegroundColor Yellow
Write-Host "   Or run: .\stop-all.ps1 to stop all" -ForegroundColor Yellow

