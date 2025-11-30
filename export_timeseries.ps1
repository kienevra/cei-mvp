param(
    # Positional: site-id like "site-1" (or leave empty for all sites)
    [string]$SiteId,

    # Positional: window in hours (default 24)
    [int]$WindowHours = 24,

    # Optional: meter-id like "main", "compressors"
    [string]$MeterId,

    # JWT token. Defaults to $env:CEI_TOKEN if not passed explicitly.
    [string]$Token = $env:CEI_TOKEN
)

if (-not $Token) {
    Write-Error "Provide a JWT access token via -Token or set `$env:CEI_TOKEN first."
    exit 1
}

$baseUrl = "http://127.0.0.1:8000/api/v1/timeseries/export"

# Build query string
$query = "?window_hours=$WindowHours"

if ($SiteId) {
    $query += "&site_id=$SiteId"
}

if ($MeterId) {
    $query += "&meter_id=$MeterId"
}

$url = $baseUrl + $query

# Output filename: timeseries_export_<site-or-all>[_meter]_XXXh.csv
$sitePart  = if ($SiteId) { $SiteId } else { "all" }
$meterPart = if ($MeterId) { "_$MeterId" } else { "" }
$outFile   = "timeseries_export_${sitePart}${meterPart}_${WindowHours}h.csv"

Write-Host "Exporting timeseries to $outFile"
Write-Host "URL: $url"

& curl.exe -H "Authorization: Bearer $Token" `
    $url `
    -o $outFile
