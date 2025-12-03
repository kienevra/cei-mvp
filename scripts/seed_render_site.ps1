param(
    # CEI site_id to seed, e.g. "site-4", "site-8", "site-22"
    [Parameter(Mandatory = $true)]
    [string]$SiteId,

    # The CEI user you log into the Heroku frontend with (same org as the site)
    [Parameter(Mandatory = $true)]
    [string]$Email,

    # That user's password
    [Parameter(Mandatory = $true)]
    [string]$Password,

    # Backend base URL (Render)
    [string]$BaseUrl = "https://cei-mvp.onrender.com",

    # How many hours of data to backfill (default 24)
    [int]$Hours = 24,

    # Base kWh value for the ramp (value + i)
    [double]$BaseValue = 150
)

Write-Host "== CEI Render seeding script ==" -ForegroundColor Cyan
Write-Host "Target base URL: $BaseUrl"
Write-Host "Target site_id : $SiteId"
Write-Host "Window (hours) : $Hours"
Write-Host ""

# 1) Login to CEI (Render backend) to get an access token
$loginBody = "username=$Email&password=$Password"

try {
    Write-Host "Logging in as $Email ..." -ForegroundColor Yellow
    $loginResponse = Invoke-RestMethod `
        -Uri "$BaseUrl/api/v1/auth/login" `
        -Method Post `
        -ContentType "application/x-www-form-urlencoded" `
        -Body $loginBody

    $token = $loginResponse.access_token
    if (-not $token) {
        throw "Login response did not contain access_token."
    }

    Write-Host "Login OK, token acquired." -ForegroundColor Green
} catch {
    Write-Host "Login failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    throw
}

# 2) Build N hourly records for the last $Hours hours
Write-Host "Building $Hours hourly records for site_id=$SiteId ..." -ForegroundColor Yellow
$records = @()

for ($i = 0; $i -lt $Hours; $i++) {
    $ts = (Get-Date).AddHours(-$i).ToUniversalTime().ToString("s") + "Z"

    $records += @{
        site_id         = $SiteId
        meter_id        = "main-incomer"
        timestamp_utc   = $ts
        value           = $BaseValue + $i  # simple ramp so baseline has variation
        unit            = "kWh"
        idempotency_key = "seed-$SiteId-$ts"
    }
}

Write-Host "Records ready." -ForegroundColor Green

# 3) Wrap into /timeseries/batch payload
$bodyObj = @{
    records = $records
    source  = "render-seed-$SiteId"
}

$bodyJson = $bodyObj | ConvertTo-Json -Depth 5

# 4) POST to /timeseries/batch
Write-Host "Posting batch to $BaseUrl/api/v1/timeseries/batch ..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/v1/timeseries/batch" `
        -Method Post `
        -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer $token" } `
        -Body $bodyJson

    Write-Host "Batch ingest result:" -ForegroundColor Green
    $response
} catch {
    Write-Host "Batch ingest failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    throw
}

Write-Host ""
Write-Host "Done. Check the CEI UI (Dashboard / SiteView / Alerts / Reports) for site $SiteId." -ForegroundColor Cyan

#from repo root run:

#Set-Location scripts
#.\seed_render_site.ps1 `
 # -SiteId "site-22" `
  #-Email "njiru@cei.local" `
  #-Password "mypassword" `
  #-Hours 24
