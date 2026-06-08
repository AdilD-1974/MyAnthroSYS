# start_backend.ps1
# Script de demarrage du backend PersonaHub HR

# ─── FORCER UTF-8 AVANT TOUT ───────────────────────────────────────────────
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
# ───────────────────────────────────────────────────────────────────────────

Set-Location "D:\SOLGEIS\personahub-api"

# Activer l'environnement virtuel Python 3.12
.\venv312\Scripts\Activate.ps1

# Variables d'environnement
$env:DATABASE_URL                = "postgresql://postgres:postgres@localhost:5432/AnthroBase"
$env:SECRET_KEY                  = "personahub-solgeis-secret-key-2025"
$env:ALGORITHM                   = "HS256"
$env:ACCESS_TOKEN_EXPIRE_MINUTES = "480"
$env:APP_NAME                    = "PersonaHub HR"
$env:APP_ENV                     = "development"
$env:ALLOWED_ORIGINS             = '["http://localhost:8080","http://localhost:5173"]'
$env:PGCLIENTENCODING            = "UTF8"

# ─── FORCER PYTHON EN UTF-8 ────────────────────────────────────────────────
$env:PYTHONUTF8      = "1"
$env:PYTHONIOENCODING = "utf-8"
# ───────────────────────────────────────────────────────────────────────────

Write-Host "Backend PersonaHub HR - Demarrage..." -ForegroundColor Cyan
Write-Host "API disponible sur : http://localhost:8000" -ForegroundColor Green
Write-Host "Documentation      : http://localhost:8000/docs" -ForegroundColor Green
Write-Host "Arreter avec       : Ctrl+C" -ForegroundColor Yellow
Write-Host ""

# Lancer FastAPI
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
