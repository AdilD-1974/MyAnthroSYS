# start_frontend.ps1
# Script de demarrage du frontend PersonaHub HR

# ─── FORCER UTF-8 AVANT TOUT ───────────────────────────────────────────────
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
# ───────────────────────────────────────────────────────────────────────────

Set-Location "D:\SOLGEIS\personahub-hr"

# ─── FORCER NODE/NPM EN UTF-8 ──────────────────────────────────────────────
$env:CHCP          = "65001"
$env:NODE_OPTIONS  = "--no-warnings"
# ───────────────────────────────────────────────────────────────────────────

Write-Host "Frontend PersonaHub HR - Demarrage..." -ForegroundColor Cyan
Write-Host "Application disponible sur : http://localhost:8080" -ForegroundColor Green
Write-Host "Arreter avec               : Ctrl+C" -ForegroundColor Yellow
Write-Host ""

npm run dev