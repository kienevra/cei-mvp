# CEI Direct API Ingestion (Timeseries Batch)

This document explains how to send hourly (or sub-hourly) meter data into CEI using the Direct API ingestion endpoint.

**Base URL**
- Production: `https://api.carbonefficiencyintel.com/api/v1`

---

## 1) Authentication (Integration Tokens)

Direct ingestion is designed for machine-to-machine use via **Integration Tokens** (org-scoped, long-lived).

### Create an integration token (owner only)
Use the CEI web UI:
- **Settings → Integration Tokens → Create**
- Copy the token once (you cannot retrieve it later).

### Send the token
Use the token as a Bearer token:

`Authorization: Bearer <CEI_INTEGRATION_TOKEN>`

> Notes
- Integration tokens are **org-scoped**.
- Tokens can be revoked at any time in Settings.
- Tokens should be stored in a secrets manager or environment variable.

---

## 2) Endpoint

### POST `/timeseries/batch`

Ingest a batch of timeseries records. This endpoint supports **idempotency** via `idempotency_key` per record.

**Request headers**
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Request body**
An object with a `records` array:

```json
{
  "records": [
    {
      "site_id": "site-4",
      "meter_id": "main",
      "timestamp_utc": "2025-12-31T00:00:00Z",
      "value": 123.45,
      "unit": "kwh",
      "idempotency_key": "site-4|main|2025-12-31T00:00:00Z"
    }
  ]
}
