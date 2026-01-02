# scripts/dev_up.ps1
$ErrorActionPreference = "Stop"

# Always run from repo root
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$backendDir = Join-Path $repoRoot "backend"
if (-not (Test-Path $backendDir)) { throw "backend/ not found at: $backendDir" }
Set-Location $backendDir

Write-Host "== CEI backend local bootstrap =="

# Ensure python exists
$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { throw "python not found on PATH." }

# Create backend venv if missing
if (-not (Test-Path ".\.venv")) {
  Write-Host "No backend/.venv found. Creating one..."
  python -m venv .venv
}

$venvPy = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { throw "Expected venv python not found at $venvPy" }

# Activate (optional)
$activate = ".\.venv\Scripts\Activate.ps1"
if (Test-Path $activate) {
  Write-Host "Activating backend/.venv..."
  . $activate
} else {
  Write-Host "WARNING: backend/.venv activation script not found."
}

# Install deps from backend/requirements.txt
if (-not (Test-Path ".\requirements.txt")) { throw "backend/requirements.txt not found (expected in backend/)." }

Write-Host "Installing backend requirements..."
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r .\requirements.txt

# Init DB + seed demo
Write-Host "Initializing SQLite DB..."
& $venvPy -m app.db.init_sqlite_db

Write-Host "Seeding demo data..."
& $venvPy -c "from app.services import demo_seed as m; m.main()"

Write-Host ""
Write-Host "Demo logins:"
Write-Host "  - Org A: dev@cei.local / devpassword"
Write-Host "  - Org B: demo2@cei.local / demo2password"
Write-Host ""

Write-Host "Starting uvicorn at http://127.0.0.1:8000 ..."
& $venvPy -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
