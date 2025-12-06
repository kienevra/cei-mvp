# CEI – Direct Timeseries Ingestion (Factory Integrations)

This document defines how external factory systems (SCADA/BMS/historian/etc.) push meter data into CEI via HTTPS.

It covers:

1. Core concepts  
2. Creating an operator account  
3. Creating an integration token  
4. `/api/v1/timeseries/batch` API contract  
5. Example `curl` call  
6. Python factory client usage  
7. Error codes & troubleshooting (`TimeseriesIngestErrorCode`)

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
  - Accepts JSON records:  
    `{site_id, meter_id, timestamp_utc, value, unit, idempotency_key}`
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

3. Create an integration token

Summary: Integration tokens (cei_int_…) are long-lived credentials for machines. They are always bound to a single organization and can call /api/v1/timeseries/batch.

Typical flow (via CEI backend, not shown in detail here):

Login as the operator user (from section 2) and obtain a short-lived JWT.

Call /api/v1/auth/integration-tokens to create a token.

Store the plaintext token value safely on the factory side (environment variables, secret store, etc.).

Use that token as: Authorization: Bearer cei_int_… in the factory client.

(Your docs/factory_client.py and scripts/run_factory_client.ps1 already assume this model.)

4. /api/v1/timeseries/batch – API contract
4.1. Endpoint

Method: POST

Path: /api/v1/timeseries/batch

Auth header:
Authorization: Bearer <access_jwt_or_integration_token>

For machine clients, this is usually:

Authorization: Bearer cei_int_XXXXXXXXXXXXXXXXXXXXXXXX

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
List of timeseries rows to ingest.

site_id (string, required)
CEI logical site key, e.g. site-22. Must belong to the org bound to the token.

meter_id (string, required)
Meter/channel identifier, e.g. main-incomer, chiller-01, etc.

timestamp_utc (string, required)
ISO8601 UTC timestamp, e.g. 2025-12-05T13:00:00Z.
Must be timezone-aware and UTC.

value (number, required)
Energy value for that time bucket (kWh in v1).

unit (string, optional, default "kWh")
Currently v1 assumes kWh. Any other unit is rejected.

idempotency_key (string, optional but strongly recommended)
Stable key so retries don’t duplicate rows.
Recommended pattern: <site_id>-<meter_id>-<timestamp_utc>.

source (string, optional)
Free-text label for where this data came from (e.g. "factory-scada-line1").

4.3. Response JSON schema

On full success:

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
      "code": "INVALID_TIMESTAMP",
      "detail": "timestamp_utc not ISO8601"
    },
    {
      "index": 12,
      "code": "DUPLICATE_IDEMPOTENCY_KEY",
      "detail": "duplicate timeseries row for this idempotency_key"
    }
  ]
}


Where:

ingested: number of records successfully written.

skipped_duplicate: records treated as duplicates and skipped (idempotency / unique constraints).

failed: records rejected by validation or org constraints.

errors[]:

index: 0-based index into your original records array.

code: short machine-readable code (see section 7. Error codes & troubleshooting).

detail: human-readable explanation. If multiple validation problems exist for one record, messages are concatenated with "; ".

Note:
There are two layers of validation:

HTTP 422 (Pydantic schema validation) – when the JSON itself doesn’t match the schema (e.g. value="abc" or timestamp_utc="not-a-timestamp").

HTTP 200 with failed > 0 – when the JSON shape is correct but the contents violate CEI’s rules (invalid unit, unknown site, org mismatch, etc.).

This document focuses on layer 2 via TimeseriesIngestErrorCode.

5. Example curl batch call (integration token)

Linux/macOS shell example:

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

7. Error codes & troubleshooting (TimeseriesIngestErrorCode)

The /api/v1/timeseries/batch service uses a dedicated enum on the backend:

class TimeseriesIngestErrorCode(str, Enum):
    UNKNOWN_SITE = "UNKNOWN_SITE"
    UNKNOWN_METER = "UNKNOWN_METER"
    ORG_MISMATCH = "ORG_MISMATCH"
    INVALID_TIMESTAMP = "INVALID_TIMESTAMP"
    INVALID_VALUE = "INVALID_VALUE"
    INVALID_UNIT = "INVALID_UNIT"
    DUPLICATE_IDEMPOTENCY_KEY = "DUPLICATE_IDEMPOTENCY_KEY"
    INTERNAL_ERROR = "INTERNAL_ERROR"


These values appear as errors[].code in the batch response.

7.1. Code overview
Code	What it means (high level)	Typical fix on factory side
UNKNOWN_SITE	site_id is syntactically present, but CEI doesn’t recognize it for any org	Check the site key; ensure the site exists in CEI and matches exactly
UNKNOWN_METER	meter_id is not recognized/configured for that site (reserved for stricter future configs)	Align meter names with CEI config; avoid ad-hoc IDs
ORG_MISMATCH	site_id exists but is not allowed for the org associated with your token	Use the correct site_id for your org or the correct token
INVALID_TIMESTAMP	timestamp_utc is missing, not ISO8601, or not timezone-aware UTC	Always send e.g. 2025-12-05T13:00:00Z
INVALID_VALUE	value could not be parsed as a number	Send a numeric type: 123.45, not a string like "123.45"
INVALID_UNIT	unit is present and not "kWh"	Either omit unit or send exactly "kWh"
DUPLICATE_IDEMPOTENCY_KEY	Inserting this row would violate the uniqueness/idempotency guarantees	Use a stable key per (site_id, meter_id, timestamp_utc) and don’t reuse incorrectly
INTERNAL_ERROR	Unexpected server-side error (DB issue, crash, etc.)	Retry later; if persistent, contact CEI support with logs

Note: In v1, UNKNOWN_METER may be rare if meters are not strictly pre-registered. It’s present for forward compatibility as CEI’s meter model tightens.

7.2. Example: “good” vs “semantically bad” record

Good record (what you just validated locally):

{
  "records": [
    {
      "site_id": "site-1",
      "meter_id": "main-incomer",
      "timestamp_utc": "2025-12-05T12:00:00Z",
      "value": 123.45,
      "unit": "kWh",
      "idempotency_key": "site-1-main-incomer-2025-12-05T12:00:00Z"
    }
  ],
  "source": "local-pilot-good-test"
}


Typical response:

{
  "ingested": 1,
  "skipped_duplicate": 0,
  "failed": 0,
  "errors": []
}


Semantically bad record (schema OK, but business rules violated):

{
  "records": [
    {
      "site_id": "",
      "meter_id": "main-incomer",
      "timestamp_utc": "2025-12-05T12:00:00Z",
      "value": 50.0,
      "unit": "MWh",
      "idempotency_key": "pilot-bad-20251205120000"
    }
  ],
  "source": "local-pilot-bad-semantic"
}


Example response (similar to what you saw in PowerShell):

{
  "ingested": 0,
  "skipped_duplicate": 0,
  "failed": 1,
  "errors": [
    {
      "index": 0,
      "code": "INVALID_UNIT",
      "detail": "site_id missing; unit must be 'kWh'"
    }
  ]
}

7.3. Example: org scoping / site mismatch

If you send a site_id that doesn’t belong to the org associated with your integration token:

{
  "records": [
    {
      "site_id": "site-does-not-exist",
      "meter_id": "main-incomer",
      "timestamp_utc": "2025-12-05T11:00:00Z",
      "value": 42.0,
      "unit": "kWh",
      "idempotency_key": "pilot-bad-org-20251205110000"
    }
  ],
  "source": "local-pilot-org-bad"
}


You’ll see something like:

{
  "ingested": 0,
  "skipped_duplicate": 0,
  "failed": 1,
  "errors": [
    {
      "index": 0,
      "code": "ORG_MISMATCH",
      "detail": "site_id 'site-does-not-exist' is not allowed for this organization"
    }
  ]
}


Fix: either:

Use a valid site_id for the current org, or

Use an integration token for the org that actually owns that site.

7.4. Example: duplicate idempotency key

If you resend exactly the same row with the same idempotency_key, the service treats it as an idempotent retry:

{
  "ingested": 0,
  "skipped_duplicate": 1,
  "failed": 0,
  "errors": [
    {
      "index": 0,
      "code": "DUPLICATE_IDEMPOTENCY_KEY",
      "detail": "duplicate timeseries row for this idempotency_key"
    }
  ]
}


This is expected and safe – CEI is telling you “I already have this row; I didn’t double-count it.”

With this model:

Your factory client can branch on errors[].code for automated remediation.

Human operators can look at detail for immediate context.

CEI preserves idempotency and org boundaries while still giving precise feedback on bad rows.