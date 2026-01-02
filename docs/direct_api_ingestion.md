CEI Direct API Ingestion (Timeseries Batch)

This document explains how to send hourly (or sub-hourly) meter data into CEI using the Direct API ingestion endpoint.

This interface is pilot-grade, production-safe, and designed for machine-to-machine factory integrations (SCADA, BMS, historian exports, cron jobs).

Base URL

Production
https://api.carbonefficiencyintel.com/api/v1

1) Authentication — Integration Tokens (Required)

Direct ingestion uses Integration Tokens (not user JWTs).

Integration tokens are:

org-scoped

long-lived

revocable

safe for unattended systems

Create an integration token (org owner only)

In the CEI web UI:

Go to Settings → Integration Tokens

Click Create

Copy the token once (it cannot be retrieved again)

Use the token

Send the token as a Bearer token:

Authorization: Bearer <CEI_INTEGRATION_TOKEN>

Important notes

Integration tokens are organization-scoped

They do not grant user access

They can ingest data and read /sites

They cannot create or delete sites

Tokens should be stored in:

environment variables

a secrets manager

NOT in source control

2) Site discovery (sanity check)

Integration tokens can read sites to verify configuration.

GET /sites
curl -H "Authorization: Bearer <TOKEN>" \
  https://api.carbonefficiencyintel.com/api/v1/sites


Response

[
  {
    "id": 26,
    "site_id": "site-26",
    "name": "Lamborghini",
    "location": "Sant'Agata Bolognese"
  }
]


Use the returned site_id values (site-<id>) in ingestion payloads.

3) Ingestion endpoint
POST /timeseries/batch

Ingest one or more timeseries records.

Supports idempotency

Supports retries

Safe to re-send the same payload

4) Request format
Headers
Authorization: Bearer <TOKEN>
Content-Type: application/json

Body
{
  "records": [
    {
      "site_id": "site-26",
      "meter_id": "meter-main-1",
      "timestamp_utc": "2025-12-31T21:00:00Z",
      "value": 123.45,
      "unit": "kWh",
      "idempotency_key": "site-26|meter-main-1|2025-12-31T21:00:00Z"
    }
  ]
}

5) Field requirements (STRICT)
Field	Required	Notes
site_id	✅	Must exist and belong to your org
meter_id	✅	Free-form string, but must be consistent
timestamp_utc	✅	ISO-8601 UTC (YYYY-MM-DDTHH:00:00Z)
value	✅	Numeric (float)
unit	✅	Must be exactly "kWh" (case-sensitive)
idempotency_key	✅	Must be unique per record
⚠️ Unit is case-sensitive

❌ Invalid:

"unit": "kwh"


✅ Valid:

"unit": "kWh"


Requests with invalid units are rejected.

6) Idempotency (IMPORTANT)

CEI enforces per-record idempotency using idempotency_key.

Same key → record is skipped

Safe to retry the same batch

Prevents duplicate ingestion on retries, restarts, or network errors

Recommended idempotency key format
<site_id>|<meter_id>|<timestamp_utc>


Example:

site-26|meter-main-1|2025-12-31T21:00:00Z

7) Response semantics (CRITICAL)

A 200 OK response does not always mean data was ingested.

Successful ingestion
{
  "ingested": 24,
  "skipped_duplicate": 0,
  "failed": 0,
  "errors": []
}

Duplicate idempotency key (EXPECTED)
{
  "ingested": 0,
  "skipped_duplicate": 1,
  "failed": 0,
  "errors": [
    {
      "index": 0,
      "code": "DUPLICATE_IDEMPOTENCY_KEY",
      "detail": "Duplicate idempotency_key (pre-check)"
    }
  ]
}


✅ This is not an error condition
✅ This indicates correct idempotent behavior

Fatal validation error
{
  "ingested": 0,
  "skipped_duplicate": 0,
  "failed": 1,
  "errors": [
    {
      "index": 0,
      "code": "INVALID_UNIT",
      "detail": "unit must be 'kWh'"
    }
  ]
}


❌ This requires operator intervention

8) Retry guidance

Clients should:

Retry on:

network errors

HTTP 429

HTTP 5xx

Not retry blindly on:

validation errors

auth errors

failed > 0 responses

The reference sender (factory_sender_minimal.py) already implements this correctly.

9) Operational checks
Ingest health
curl -H "Authorization: Bearer <TOKEN>" \
  https://api.carbonefficiencyintel.com/api/v1/timeseries/ingest_health


This returns per-site/meter completeness and last-seen timestamps.

Export verification
curl -H "Authorization: Bearer <TOKEN>" \
  "https://api.carbonefficiencyintel.com/api/v1/timeseries/export?window_hours=48&site_id=site-26&meter_id=meter-main-1"

10) Reference implementation

See:

docs/examples/factory_sender_minimal.py

backend/scripts/run_factory_sender_minimal.ps1

These are pilot-grade and match production behavior exactly.

Summary (what factories must know)

Use integration tokens, not user logins

unit must be exactly kWh

Idempotency is enforced — duplicates are skipped

failed > 0 means stop and fix input

/sites works for integration tokens

Safe to retry on network/server errors

This contract is stable for pilots and forward-compatible with full production rollout.