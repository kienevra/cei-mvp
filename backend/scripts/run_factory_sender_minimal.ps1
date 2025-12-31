# Minimal runner for Windows Task Scheduler
# Usage examples:
#   .\backend\scripts\run_factory_sender_minimal.ps1 -Mode ramp -SiteId site-4
#   .\backend\scripts\run_factory_sender_minimal.ps1 -Mode csv -CsvPath .\data\export.csv

param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("csv","ramp")]
  [string]$Mode,

  [string]$CsvPath = "",

  [string]$SiteId = "",
  [string]$MeterId = "main",
  [int]$Hours = 24,

  [string]$BaseUrl = $env:CEI_BASE_URL,
  [string]$Token = $env:CEI_TOKEN
)

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  Write-Error "CEI_BASE_URL is missing. Set it as an environment variable or pass -BaseUrl."
  exit 2
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  Write-Error "CEI_TOKEN is missing. Set it as an environment variable or pass -Token."
  exit 2
}

# Prefer the Python launcher on Windows; fall back to python
$py = "py"
$pyArgs = @("-3")
try {
  & $py @pyArgs --version | Out-Null
} catch {
  $py = "python"
  $pyArgs = @()
}

# Compute repo root (this script is at: backend/scripts/...)
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# Python sender lives in: docs/examples/...
$script = Join-Path $repoRoot "docs\examples\factory_sender_minimal.py"

if (-not (Test-Path -LiteralPath $script)) {
  Write-Error "Sender script not found: $script"
  exit 2
}

if ($Mode -eq "csv") {
  if ([string]::IsNullOrWhiteSpace($CsvPath)) {
    Write-Error "-CsvPath is required for Mode=csv"
    exit 2
  }

  # Make CsvPath absolute so Task Scheduler / different working dirs don't break it
  $csvFullPath = $null
  try {
    $csvFullPath = (Resolve-Path -LiteralPath $CsvPath).Path
  } catch {
    Write-Error "CSV file not found: $CsvPath"
    exit 2
  }

  & $py @pyArgs $script --mode csv --csv-path $csvFullPath --base-url $BaseUrl --token $Token
  exit $LASTEXITCODE
}

if ($Mode -eq "ramp") {
  if ([string]::IsNullOrWhiteSpace($SiteId)) {
    Write-Error "-SiteId is required for Mode=ramp"
    exit 2
  }

  & $py @pyArgs $script --mode ramp --site-id $SiteId --meter-id $MeterId --hours $Hours --base-url $BaseUrl --token $Token
  exit $LASTEXITCODE
}

Write-Error "Unknown mode"
exit 2
