# CEI – Direct Timeseries Ingestion (Factory Integrations)

This document defines how external factory systems (SCADA/BMS/historian/etc.) push meter data into CEI via HTTPS.

It covers:

1. Core concepts
2. Creating an operator account
3. Creating an integration token
4. `/api/v1/timeseries/batch` API contract
5. Example `curl` call
6. Python factory client usage

---

## 1. Core concepts

- **Base URL**
  - **Local dev:** `http://127.0.0.1:8000`
  - **Render prod:** `https://cei-mvp.onrender.com`

- **Authentication model**
  - Interactive humans use **short-lived JWT access tokens** (login/signup).
  - Machines use **long-lived integration tokens** (`cei_int_…`) that are:
    - Bound to a single **organization**
    - Stored as a **hash** on the backend
    - Resolvable via `get_org_context()` and used to scope all writes.

- **Ingestion endpoint**
  - `POST /api/v1/timeseries/batch`
  - Accepts JSON records: `{site_id, meter_id, timestamp_utc, value, unit, idempotency_key}`
  - Enforced:
    - Org scoping
    - Rate limiting
    - Structured error reporting

---

## 2. Create (or reuse) the operator account

You need at least one “operator” user per factory org. That user is used to create integration tokens.

### 2.1. Via API (Render)

```powershell
# From Windows PowerShell, in repo root

# Try signup first
$signupPayload = @{
    email             = "factory-operator@cei.local"  # change to real email
    password          = "mypassword"                  # set a proper strong password
    full_name         = "Factory Operator"
    organization_name = "Factory Org A"
} | ConvertTo-Json

try {
    $signupResponse = Invoke-RestMethod `
      -Uri "https://cei-mvp.onrender.com/api/v1/auth/signup" `
      -Method Post `
      -ContentType "application/json" `
      -Body $signupPayload

    Write-Host "Signup OK"
    $env:CEI_RENDER_JWT = $signupResponse.access_token
}
catch {
    Write-Host "Signup failed, likely already registered. Trying login..."

    $body = "username=factory-operator@cei.local&password=mypassword"

    $loginResponse = Invoke-RestMethod `
      -Uri "https://cei-mvp.onrender.com/api/v1/auth/login" `
      -Method Post `
      -ContentType "application/x-www-form-urlencoded" `
      -Body $body

    $env:CEI_RENDER_JWT = $loginResponse.access_token
}

# Sanity check: should print a long JWT
$env:CEI_RENDER_JWT

# Optional: verify account + org/plan flags
Invoke-RestMethod `
  -Uri "https://cei-mvp.onrender.com/api/v1/account/me" `
  -Headers @{ Authorization = "Bearer $env:CEI_RENDER_JWT" }




4. /api/v1/timeseries/batch – API contract
4.1. Endpoint

Method: POST

Path: /api/v1/timeseries/batch

Auth: Authorization: Bearer <access_jwt_or_integration_token>

For machine clients, this is usually Bearer cei_int_…

4.2. Request JSON schema

Top-level:

{
  "records": [
    {
      "site_id": "site-22",
      "meter_id": "main-incomer",
      "timestamp_utc": "2025-12-05T13:00:00Z",
      "value": 152.3,
      "unit": "kWh",
      "idempotency_key": "factory-line1-2025-12-05T13:00:00Z"
    }
  ],
  "source": "factory-scada-line1"
}


Field semantics:

records (required, non-empty array)

site_id (string, required)

CEI logical site key, e.g. site-22.

meter_id (string, required)

Meter/channel identifier, e.g. main-incomer, chiller-01, etc.

timestamp_utc (string, required)

ISO8601 UTC timestamp, e.g. 2025-12-05T13:00:00Z.

value (number, required)

Energy value for that time bucket (kWh in v1).

unit (string, optional, default "kWh")

Currently v1 assumes kWh; future-proof field.

idempotency_key (string, optional but strongly recommended)

Stable key so retries don’t duplicate rows.

Recommended pattern: <site_id>-<meter_id>-<timestamp_utc>.

source (string, optional)

Free-text label for where this data came from (e.g. "factory-scada-line1").

4.3. Response JSON schema

On success:

{
  "ingested": 24,
  "skipped_duplicate": 0,
  "failed": 0,
  "errors": []
}


On partial failure:

{
  "ingested": 20,
  "skipped_duplicate": 2,
  "failed": 2,
  "errors": [
    {
      "index": 5,
      "code": "VALIDATION_ERROR",
      "detail": "timestamp_utc must be a valid ISO8601 UTC string"
    },
    {
      "index": 12,
      "code": "CONSTRAINT_ERROR",
      "detail": "duplicate (site_id, meter_id, timestamp_utc, idempotency_key)"
    }
  ]
}


Where:

ingested: number of records written.

skipped_duplicate: records treated as duplicates and skipped.

failed: records rejected.

errors[]:

index: 0-based index into your original records array.

code: short machine-readable code.

detail: human-readable explanation.

5. Example curl batch call (integration token)
# Linux/macOS shell example
export CEI_BASE_URL="https://cei-mvp.onrender.com"
export CEI_INT_TOKEN="cei_int_XXXXXXXXXXXXXXXXXXXXXXXX"

cat << 'EOF' > payload.json
{
  "records": [
    {
      "site_id": "site-22",
      "meter_id": "main-incomer",
      "timestamp_utc": "2025-12-05T13:00:00Z",
      "value": 150.0,
      "unit": "kWh",
      "idempotency_key": "site-22-main-incomer-2025-12-05T13:00:00Z"
    },
    {
      "site_id": "site-22",
      "meter_id": "main-incomer",
      "timestamp_utc": "2025-12-05T14:00:00Z",
      "value": 151.0,
      "unit": "kWh",
      "idempotency_key": "site-22-main-incomer-2025-12-05T14:00:00Z"
    }
  ],
  "source": "factory-scada-line1"
}
EOF

curl "$CEI_BASE_URL/api/v1/timeseries/batch" \
  -H "Authorization: Bearer $CEI_INT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @payload.json


Expected happy-path response:

{"ingested":2,"skipped_duplicate":0,"failed":0,"errors":[]}

6. Python factory client usage

A reference client lives at:

docs/factory_client.py

This is a simple CLI wrapper around /api/v1/timeseries/batch, suitable as a starting point for real factory integrations.

6.1. Configuration

Set these environment variables:

# Windows PowerShell

# Render base URL
$env:CEI_BASE_URL  = "https://cei-mvp.onrender.com"

# Integration token created earlier (cei_int_…)
$env:CEI_INT_TOKEN = "cei_int_e8AzQEPyQNwR1mD88xhEfswMK-TOBN2jAAxsHH0pjjQ"

6.2. CLI invocation

From repo root:

python .\docs\factory_client.py <site_id> <meter_id> <hours_back>


Example (what was already validated against Render):

cd C:\Users\leonm\myproject-restored

$env:CEI_BASE_URL  = "https://cei-mvp.onrender.com"
$env:CEI_INT_TOKEN = "cei_int_e8AzQEPyQNwR1mD88xhEfswMK-TOBN2jAAxsHH0pjjQ"

python .\docs\factory_client.py site-22 main-incomer 24


Expected log:

=== CEI Python factory client ===
Base URL : https://cei-mvp.onrender.com
Site ID  : site-22
Meter ID : main-incomer
Hours    : 24
... Sending batch to https://cei-mvp.onrender.com/api/v1/timeseries/batch (records=24, source=sample-ramp-site-22)
... CEI batch result: ingested=24 skipped_duplicate=0 failed=0
Batch result: {'ingested': 24, 'skipped_duplicate': 0, 'failed': 0, 'errors': []}


At that point:

Data is in CEI (Postgres on Render),

Analytics/alerts/reports can see it,

The factory has a reproducible, documented way to push data into CEI.

::contentReference[oaicite:0]{index=0}