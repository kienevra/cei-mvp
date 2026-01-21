# scripts/smoke_prod.ps1
# CEI smoke test for BOTH prod (integration token) and local dev (email/password -> JWT)
# - Uses curl.exe (not Invoke-RestMethod) to keep behavior consistent across Windows boxes.
# - Avoids the "$k: ..." PowerShell parsing bug by formatting headers safely.
# - No "||" separators (your PowerShell doesn't support them).
# SAFETY HARDENING:
# - If base is HTTPS + CEI_INT_TOKEN is set, script defaults to read-only unless -ForceIngest is used.
# - Default MeterId is "meter-smoke" to isolate test writes.
# OPTION A HARDENING:
# - In READ-ONLY mode, if MeterId was NOT explicitly provided, auto-switch to "meter-main-1"
#   so summary/series returns real data without requiring flags.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$SiteId = "",

  [Parameter(Mandatory = $false)]
  [string]$MeterId = "meter-smoke",

  [Parameter(Mandatory = $false)]
  [int]$WindowHours = 72,

  [Parameter(Mandatory = $false)]
  [int]$LookbackDays = 30,

  # Read-only mode (explicit)
  [Parameter(Mandatory = $false)]
  [switch]$NoIngest,

  # Override prod safety and allow ingest on HTTPS + integration token
  [Parameter(Mandatory = $false)]
  [switch]$ForceIngest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host ("=" * 88)
  Write-Host $Title
  Write-Host ("=" * 88)
}

function Fail([string]$Message) {
  Write-Host ""
  Write-Error $Message
  exit 1
}

function Normalize-BaseUrl([string]$Base) {
  if ([string]::IsNullOrWhiteSpace($Base)) { return "" }
  $b = $Base.Trim()
  if ($b.EndsWith("/")) { $b = $b.TrimEnd("/") }
  return $b
}

function Curl-Json {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $false)][hashtable]$Headers = @{},
    [Parameter(Mandatory = $false)][string]$Body = "",
    [Parameter(Mandatory = $false)][string]$BodyFile = ""
  )

  $args = @("-s", "-X", $Method, $Url)

  if ($Headers -and $Headers.Keys.Count -gt 0) {
    foreach ($k in $Headers.Keys) {
      $args += "-H"
      # SAFE formatting (no "$k: ..." parsing issues)
      $args += ("{0}: {1}" -f $k, $Headers[$k])
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($BodyFile)) {
    $args += "--data-binary"
    $args += ("@{0}" -f $BodyFile)
  }
  elseif (-not [string]::IsNullOrWhiteSpace($Body)) {
    $args += "--data-binary"
    $args += $Body
  }

  $out = & curl.exe @args
  return $out
}

function Curl-Text {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $false)][hashtable]$Headers = @{}
  )

  $args = @("-s", "-X", $Method, $Url)

  if ($Headers -and $Headers.Keys.Count -gt 0) {
    foreach ($k in $Headers.Keys) {
      $args += "-H"
      $args += ("{0}: {1}" -f $k, $Headers[$k])
    }
  }

  $out = & curl.exe @args
  return $out
}

function Get-AuthHeader {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl
  )

  # If integration token is present -> use it (prod / machine auth)
  if (-not [string]::IsNullOrWhiteSpace($env:CEI_INT_TOKEN)) {
    return @{ "Authorization" = ("Bearer {0}" -f $env:CEI_INT_TOKEN) }
  }

  # Otherwise, try email/password -> /auth/login -> access_token
  if ([string]::IsNullOrWhiteSpace($env:CEI_EMAIL) -or [string]::IsNullOrWhiteSpace($env:CEI_PASSWORD)) {
    Fail "Missing auth. Set CEI_INT_TOKEN (preferred for prod) OR set CEI_EMAIL + CEI_PASSWORD (local dev JWT)."
  }

  $loginUrl = "{0}/auth/login" -f $BaseUrl
  $form = "username=$($env:CEI_EMAIL)&password=$($env:CEI_PASSWORD)"
  $resp = & curl.exe -s -X POST $loginUrl -H "Content-Type: application/x-www-form-urlencoded" --data $form

  if ([string]::IsNullOrWhiteSpace($resp)) {
    Fail "Login failed: empty response from $loginUrl"
  }

  try {
    $obj = $resp | ConvertFrom-Json
  } catch {
    Fail ("Login failed: non-JSON response: {0}" -f $resp)
  }

  if (-not $obj.access_token) {
    Fail ("Login failed: missing access_token. Response: {0}" -f $resp)
  }

  return @{ "Authorization" = ("Bearer {0}" -f $obj.access_token) }
}

function Pick-Default-Site {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][hashtable]$AuthHeaders
  )

  $sitesUrl = "{0}/sites" -f $BaseUrl
  $resp = Curl-Json -Method "GET" -Url $sitesUrl -Headers $AuthHeaders

  try {
    $arr = $resp | ConvertFrom-Json
  } catch {
    Fail ("Failed to parse /sites response as JSON: {0}" -f $resp)
  }

  if (-not $arr -or $arr.Count -lt 1) {
    Fail "No sites returned from /sites; cannot continue."
  }

  $first = $arr[0]
  if ($first.site_id) { return [string]$first.site_id }
  if ($first.id) { return ("site-{0}" -f [int]$first.id) }

  Fail ("Could not derive site_id from /sites response item: {0}" -f ($first | ConvertTo-Json -Depth 8))
  return ""
}

function Write-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Obj
  )
  $json = $Obj | ConvertTo-Json -Depth 10
  Set-Content -Path $Path -Encoding UTF8 -Value $json
}

function Assert-Export-Contains-Once {
  param(
    [Parameter(Mandatory = $true)][string]$CsvText,
    [Parameter(Mandatory = $true)][string[]]$Needles
  )

  $lines = @(
    ($CsvText -split "(`r`n|`n|`r)") |
      ForEach-Object { $_.TrimEnd() } |
      Where-Object { $_ -and $_.Trim() -ne "" }
  )

  $hits = @()
  foreach ($needle in $Needles) {
    $matched = @($lines | Where-Object { $_ -match ([regex]::Escape($needle)) })
    if ($matched.Count -ne 1) {
      if ($matched.Count -eq 0) {
        Fail ("Export verify failed: missing timestamp '{0}'" -f $needle)
      } else {
        Fail ("Export verify failed: timestamp '{0}' appeared {1} times (expected exactly 1). Examples: {2}" -f $needle, $matched.Count, ($matched[0..([Math]::Min(2, $matched.Count-1))] -join " | "))
      }
    }
    $hits += $matched[0]
  }

  # Also ensure the three lines are distinct
  $uniqueHits = $hits | Sort-Object -Unique
  if ($uniqueHits.Count -ne $hits.Count) {
    Fail "Export verify failed: duplicate export lines detected among the expected hits."
  }

  $uniqueHits | ForEach-Object { Write-Host $_ }
}

# ---------------------------
# Main
# ---------------------------

$base = Normalize-BaseUrl $env:CEI_BASE_URL
if ([string]::IsNullOrWhiteSpace($base)) {
  Fail 'Set $env:CEI_BASE_URL (example: "https://api.carbonefficiencyintel.com/api/v1" or "http://127.0.0.1:8000/api/v1").'
}

$baseLower = $base.ToLower()
$isHttps = $baseLower.StartsWith("https://")
$usingInt = -not [string]::IsNullOrWhiteSpace($env:CEI_INT_TOKEN)

# Effective mode:
# - If HTTPS + integration token => default READ-ONLY unless explicitly overridden with -ForceIngest
$effectiveNoIngest = $NoIngest
$readOnlyAuto = $false

if ($isHttps -and $usingInt -and (-not $ForceIngest)) {
  if (-not $NoIngest) { $readOnlyAuto = $true }
  $effectiveNoIngest = $true
}

Write-Section ("CEI Smoke Test | base={0}" -f $base)

if ($effectiveNoIngest) {
  Write-Host "Mode: READ-ONLY (no ingest)"
  if ($readOnlyAuto) {
    Write-Host "Reason: HTTPS base + integration token detected. Pass -ForceIngest to override."
  } else {
    Write-Host "Reason: -NoIngest specified."
  }
} else {
  Write-Host "Mode: INGEST + VERIFY"
  if ($isHttps -and $usingInt) {
    Write-Host "WARNING: You are ingesting into HTTPS using an integration token. This will create real prod data."
  }
}

$auth = Get-AuthHeader -BaseUrl $base

# Health
Write-Section "Health"
$healthUrl = "{0}/health" -f $base
$health = Curl-Text -Method "GET" -Url $healthUrl
Write-Host $health

# Sites
Write-Section "Sites"
$sitesUrl = "{0}/sites" -f $base
$sitesRaw = Curl-Json -Method "GET" -Url $sitesUrl -Headers $auth
Write-Host $sitesRaw

if ([string]::IsNullOrWhiteSpace($SiteId)) {
  $SiteId = Pick-Default-Site -BaseUrl $base -AuthHeaders $auth
  Write-Host ("Using default SiteId = {0}" -f $SiteId)
} else {
  Write-Host ("Using provided SiteId = {0}" -f $SiteId)
}

# Option A: In READ-ONLY mode, default to the real production meter unless user explicitly passed -MeterId.
if ($effectiveNoIngest -and (-not $PSBoundParameters.ContainsKey("MeterId"))) {
  $MeterId = "meter-main-1"
  Write-Host ("Read-only: defaulting MeterId to {0}" -f $MeterId)
}

Write-Host ("MeterId = {0}" -f $MeterId)

# Optionally ingest 3 points + verify dedupe + export presence
if (-not $effectiveNoIngest) {
  Write-Section "Ingest (3 points) + Dedupe + Export Verify"

  $idemPrefix = "cei_smoke_{0}" -f ([Guid]::NewGuid().ToString("N").Substring(0, 10))
  $nowUtc = [DateTime]::UtcNow
  $t1 = $nowUtc.AddHours(-2).ToString("yyyy-MM-ddTHH:00:00Z")
  $t2 = $nowUtc.AddHours(-1).ToString("yyyy-MM-ddTHH:00:00Z")
  $t3 = $nowUtc.ToString("yyyy-MM-ddTHH:00:00Z")

  $payload = @{
    records = @(
      @{ site_id=$SiteId; meter_id=$MeterId; timestamp_utc=$t1; value=10.5; unit="kWh"; idempotency_key=("$idemPrefix-1") },
      @{ site_id=$SiteId; meter_id=$MeterId; timestamp_utc=$t2; value=11.0; unit="kWh"; idempotency_key=("$idemPrefix-2") },
      @{ site_id=$SiteId; meter_id=$MeterId; timestamp_utc=$t3; value=12.0; unit="kWh"; idempotency_key=("$idemPrefix-3") }
    )
  }

  $tmpPath = Join-Path $PWD "smoke_batch_payload.json"
  Write-JsonFile -Path $tmpPath -Obj $payload
  Write-Host ("Payload written: {0}" -f $tmpPath)

  $ingestUrl = "{0}/timeseries/batch" -f $base
  $headers = @{}
  foreach ($k in $auth.Keys) { $headers[$k] = $auth[$k] }
  $headers["Content-Type"] = "application/json"

  Write-Host "Ingest #1"
  $ing1 = Curl-Json -Method "POST" -Url $ingestUrl -Headers $headers -BodyFile $tmpPath
  Write-Host $ing1

  Write-Host "Ingest #2 (same payload -> expect DUPLICATE_IDEMPOTENCY_KEY)"
  $ing2 = Curl-Json -Method "POST" -Url $ingestUrl -Headers $headers -BodyFile $tmpPath
  Write-Host $ing2

  Write-Host "Export verify (must find exactly 3 unique lines, one per timestamp)"
  $exportUrl = "{0}/timeseries/export?window_hours={1}&site_id={2}&meter_id={3}" -f $base, $WindowHours, $SiteId, $MeterId
  $csv = Curl-Text -Method "GET" -Url $exportUrl -Headers $auth

  # Match ignoring Z vs +00:00 by searching the exact hour timestamp without timezone suffix:
  # "YYYY-MM-DDTHH:00:00" (19 chars)
  $h1 = $t1.Substring(0, 19)
  $h2 = $t2.Substring(0, 19)
  $h3 = $t3.Substring(0, 19)

  Assert-Export-Contains-Once -CsvText $csv -Needles @($h1, $h2, $h3)
}

# Timeseries summary/series
Write-Section ("Timeseries Summary/Series | window_hours={0}" -f $WindowHours)

$summaryUrl = "{0}/timeseries/summary?window_hours={1}&site_id={2}&meter_id={3}" -f $base, $WindowHours, $SiteId, $MeterId
$seriesUrl  = "{0}/timeseries/series?window_hours={1}&site_id={2}&meter_id={3}"  -f $base, $WindowHours, $SiteId, $MeterId

Write-Host "Summary:"
Write-Host (Curl-Json -Method "GET" -Url $summaryUrl -Headers $auth)
Write-Host ""
Write-Host "Series:"
Write-Host (Curl-Json -Method "GET" -Url $seriesUrl -Headers $auth)

# KPI
Write-Section ("KPI | lookback_days={0}" -f $LookbackDays)
$kpiUrl = "{0}/analytics/sites/{1}/kpi?lookback_days={2}" -f $base, $SiteId, $LookbackDays
Write-Host (Curl-Json -Method "GET" -Url $kpiUrl -Headers $auth)

# Insights (7d)
Write-Section ("Insights | window_hours=168 lookback_days={0}" -f $LookbackDays)
$insightsUrl = "{0}/analytics/sites/{1}/insights?window_hours=168&lookback_days={2}" -f $base, $SiteId, $LookbackDays
Write-Host (Curl-Json -Method "GET" -Url $insightsUrl -Headers $auth)

Write-Section "DONE"
Write-Host "Smoke test completed."
