param(
    [Parameter(Mandatory = $false)]
    [string]$SiteId   = "site-22",

    [Parameter(Mandatory = $false)]
    [string]$MeterId  = "main-incomer",

    [Parameter(Mandatory = $false)]
    [int]$HoursBack   = 24
)

# --- Static project + CEI config for now ---

# Repo root on your machine
$projectRoot = "C:\Users\leonm\myproject-restored"

# CEI production backend (Render)
$env:CEI_BASE_URL = "https://cei-mvp.onrender.com"

# Integration token – SHORT TERM: hard-wired for your dev box.
# LONG TERM: set this as a machine-level env var on the factory server.
if (-not $env:CEI_INT_TOKEN -or -not $env:CEI_INT_TOKEN.StartsWith("cei_int_")) {
    $env:CEI_INT_TOKEN = "cei_int_e8AzQEPyQNwR1mD88xhEfswMK-TOBN2jAAxsHH0pjjQ"
}

# --- Activate virtualenv if present ---

$venvActivate = Join-Path $projectRoot "backend\.venv\Scripts\Activate.ps1"
if (Test-Path $venvActivate) {
    . $venvActivate
}

Set-Location $projectRoot

Write-Host "=== CEI scheduled factory client run ==="
Write-Host "Base URL : $env:CEI_BASE_URL"
Write-Host "Site ID  : $SiteId"
Write-Host "Meter ID : $MeterId"
Write-Host "Hours    : $HoursBack"
Write-Host ""

# --- Run the Python factory client ---

python ".\docs\factory_client.py" $SiteId $MeterId $HoursBack
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Error "factory_client.py exited with code $exitCode"
    exit $exitCode
}
