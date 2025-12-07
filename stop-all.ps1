# PowerShell script to stop all Watchlight services
# Usage: .\stop-all.ps1

Write-Host "🛑 Stopping all Watchlight services..." -ForegroundColor Yellow
Write-Host ""

# Stop all Node.js processes (be careful with this!)
$processes = Get-Process -Name node -ErrorAction SilentlyContinue

if ($processes) {
    $processes | Stop-Process -Force
    Write-Host "✅ Stopped all Node.js processes" -ForegroundColor Green
} else {
    Write-Host "   No Node.js processes found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "💡 Note: This stops ALL Node.js processes. Use with caution!" -ForegroundColor Yellow

