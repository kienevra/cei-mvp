param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBase,

    [Parameter(Mandatory = $true)]
    [string]$LoginEmail,

    # Dev-only: plain-text password accepted for convenience.
    # Suppress PSScriptAnalyzer warning PSAvoidUsingPlainTextForPassword.
    [Parameter(Mandatory = $true)]
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute("PSAvoidUsingPlainTextForPassword", "")]
    [string]$LoginPassword,

    [Parameter(Mandatory = $true)]
    [string]$SiteKey,

    [int]$HoursBack = 24
)

Write-Host "=== CEI Render seeding script ===" -ForegroundColor Cyan
Write-Host "API base : $ApiBase"
Write-Host "Email    : $LoginEmail"
Write-Host "Site key : $SiteKey"
Write-Host "Hours    : $HoursBack"
Write-Host ""

# 1) Log in to CEI (Render) to get a short-lived access token
$loginBody = "username=$LoginEmail&password=$LoginPassword"

try {
    Write-Host "Logging in to $ApiBase ..." -ForegroundColor Yellow
    $loginResponse = Invoke-RestMethod `
        -Uri "$ApiBase/api/v1/auth/login" `
        -Method Post `
        -ContentType "application/x-www-form-urlencoded" `
        -Body $loginBody
} catch {
    Write-Host "Login failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "Details:" $_.ErrorDetails.Message
    }
    exit 1
}

$accessToken = $loginResponse.access_token
if (-not $accessToken) {
    Write-Host "No access_token returned from login. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host "Login OK. Got access token." -ForegroundColor Green

# 2) Build synthetic timeseries records for the last N hours
$records = @()
for ($i = 0; $i -lt $HoursBack; $i++) {
    # hour i hours ago, rounded to the hour, UTC
    $ts = (Get-Date).AddHours(-$i).ToUniversalTime().ToString("s") + "Z"

    $records += @{
        site_id         = $SiteKey
        meter_id        = "main-incomer"
        timestamp_utc   = $ts
        value           = 150 + $i      # simple ramp so baselines have variation
        unit            = "kWh"
        idempotency_key = "seed-$SiteKey-$ts"
    }
}

Write-Host "Built $($records.Count) records for site $SiteKey." -ForegroundColor Yellow

# 3) Wrap records into /timeseries/batch payload
$batchBody = @{
    records = $records
    source  = "render-seed-$SiteKey"
} | ConvertTo-Json -Depth 5

# 4) Call /timeseries/batch on Render using the login JWT
try {
    Write-Host "Calling /api/v1/timeseries/batch on $ApiBase ..." -ForegroundColor Yellow
    $batchResponse = Invoke-RestMethod `
        -Uri "$ApiBase/api/v1/timeseries/batch" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer $accessToken" } `
        -Body $batchBody
} catch {
    Write-Host "Batch ingest failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host "Details:" $_.ErrorDetails.Message
    }
    exit 1
}

Write-Host "Batch ingest completed." -ForegroundColor Green
Write-Host ("Ingested        : {0}" -f $batchResponse.ingested)
Write-Host ("Skipped duplicate: {0}" -f $batchResponse.skipped_duplicate)
Write-Host ("Failed          : {0}" -f $batchResponse.failed)

if ($batchResponse.errors -and $batchResponse.errors.Count -gt 0) {
    Write-Host "Errors:" -ForegroundColor Yellow
    $batchResponse.errors | ForEach-Object {
        Write-Host ("  [index={0}] code={1} detail={2}" -f $_.index, $_.code, $_.detail)
    }
}

Write-Host "=== Done seeding $SiteKey on Render ===" -ForegroundColor Cyan
