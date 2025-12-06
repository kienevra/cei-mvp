# CEI Pilot Runbook – Direct Timeseries Ingestion (v0.1)

This runbook describes how to set up and run a CEI pilot with a real factory.

It covers:

1. What CEI needs from the factory.
2. How to create an org + admin user in CEI.
3. How to generate an integration token.
4. How to configure and run the CEI factory client.
5. How to validate data ingestion in CEI.
6. How to monitor and operate the pilot.

---

## 1. Pilot Scope & Requirements

### 1.1 What CEI does in a pilot

- Ingests hourly (or sub-hourly) energy/meter data from the factory.
- Stores the data per **organization → site → meter**.
- Builds baselines and simple forecasts.
- Surfaces:
  - Portfolio dashboard.
  - Per-site trends (last 24h / last 7d).
  - Alerts (baseline deviation, spikes, weekend/weekday, etc.).
  - Reports (7-day view, CSV exports).

### 1.2 What we need from the factory

Minimum requirements:

- **One site** with at least one **electricity meter** (kWh or kW).
- Historical data (ideally 30–90 days) in one of these forms:
  - CSV export with columns:
    - `timestamp_utc`
    - `site_id`
    - `meter_id`
    - `value`
    - `unit` (e.g. `kWh`)
    - `idempotency_key` (optional but recommended)
  - OR the ability to push hourly data via a custom client using CEI’s JSON API.

- A **Windows or Linux machine** that can:
  - Reach `https://cei-mvp.onrender.com`.
  - Run a scheduled job hourly (Task Scheduler / cron / systemd timer).

---

## 2. Create Organization & Admin User

> This is done by the CEI operator (you) on the hosted CEI instance.

1. Go to the CEI frontend (Heroku URL).
2. Use the **sign-up** flow with the factory admin’s email (or your own, then change later).
3. The backend will:
   - Create a new `Organization`.
   - Create a `User` as org admin.
   - Assign default plan flags:
     - `subscription_plan_key = "cei-starter"`
     - `enable_alerts = true`
     - `enable_reports = true`
     - `subscription_status = "active"`

4. Log in as this user and confirm:
   - `/auth/me` (via Swagger or internal tools) shows:
     - A valid `organization_id`.
     - Plan fields as above.

This org will own all sites, meters, and timeseries for the pilot.

---

## 3. Generate Integration Token

> Integration tokens are long-lived, org-scoped secrets used for machine-to-machine ingestion.

1. Log in as the org admin.
2. Open the **Settings → Integration Tokens** page in the CEI frontend.
3. Click **“Create integration token”**.
4. CEI calls:
   - `POST /api/v1/auth/integration-tokens`
   - The backend creates an `IntegrationToken` row with:
     - `organization_id`
     - `token_hash` (SHA256)
     - `is_active = true`
     - `created_at`, `last_used_at = null`

5. The frontend displays the raw token once, in the form:

   ```text
   cei_int_xxxxxxxxxxxxxxxxx

Copy this token and store it securely. It will not be retrievable again.

3.1 How this token is used

All ingestion calls to:

POST /api/v1/timeseries/batch
Authorization: Bearer cei_int_xxxxxxxxxxxxx


The backend uses get_org_context to:

Recognize this as an integration token.

Attach organization_id to the request.

Scope all TimeseriesRecord writes to that org.

4. Configure the Factory Client

CEI ships with a reference client at docs/factory_client.py.

It supports two modes:

Ramp mode – synthetic test data for smoke testing.

CSV mode – ingest from a factory CSV export.

4.1 Environment variables on the factory machine

Set the following env vars on the machine running the client:

CEI_BASE_URL
e.g.

https://cei-mvp.onrender.com


CEI_INT_TOKEN
The integration token generated in section 3, e.g.

cei_int_xxxxxxxxxxxxxxxxx


Optional for CSV mode:

CEI_FACTORY_CSV_PATH
Absolute or relative path to the CSV file, e.g.

C:\cei\factory-data\site22_meter_main.csv

4.2 Ramp Mode (test ingestion)

Command (Windows, from repo root):

python .\docs\factory_client.py <site_id> <meter_id> <hours_back>


Example:

python .\docs\factory_client.py site-22 main-meter 24


Behavior:

Builds hourly records for the last N hours:

timestamp_utc: current_utc - i hours.

site_id: as provided.

meter_id: as provided.

value: ramping test values (e.g. base + i).

unit: "kWh" (default).

Sends a TimeseriesBatchRequest to:

POST /api/v1/timeseries/batch


Retries on transient errors.

Prints summary:

Ingested: X, Skipped duplicates: Y, Failed: Z


Use this mode to smoke-test connectivity and auth before using real data.

4.3 CSV Mode (real data ingestion)

Preconditions:

CEI_FACTORY_CSV_PATH is set.

CSV has headers:

timestamp_utc

site_id

meter_id

value

unit

idempotency_key (optional but recommended)

Run:

python .\docs\factory_client.py


Behavior:

Reads all rows from the CSV.

Builds one TimeseriesBatchRecord per row.

Sends them to /timeseries/batch with a source derived from the CSV filename.

Returns non-zero exit code on permanent failure (for schedulers).

5. Scheduling Hourly Runs (Windows Task Scheduler)

This section describes a typical Windows setup using scripts/run_factory_client.ps1.

5.1 Prepare the script

Ensure the repo (or a copy with the client + script) is on the factory machine.

Confirm that scripts/run_factory_client.ps1:

Reads env vars: CEI_BASE_URL, CEI_INT_TOKEN, CEI_FACTORY_CSV_PATH.

Calls:

python .\docs\factory_client.py <site_id> <meter_id> <hours_back>


Exits with the same code as factory_client.py.

5.2 Create the scheduled task

Open Task Scheduler.

Create a Basic Task:

Name: CEI – Timeseries Ingestion.

Trigger:

Daily, repeat every 1 hour (or as required).

Action:

Program/script: powershell.exe

Arguments:

-ExecutionPolicy Bypass -File "C:\path\to\scripts\run_factory_client.ps1"


Start in: C:\path\to\repo-root

Set the task to:

Run whether user is logged on or not.

Use an account with rights to the folder and internet.

Test:

Right-click → Run.

Check logs/output to confirm success.

(For Linux servers, use cron or systemd timers with equivalent commands.)

6. Validating Data in CEI

Once data is flowing, validate end-to-end.

6.1 Backend checks (Swagger / API)

Use Swagger UI on the backend (/docs if enabled, or via internal tools).

For the pilot org/token:

Summary:

GET /api/v1/timeseries/summary?site_id=<site_id>&meter_id=<meter_id>&window_hours=24


Expect:

Non-zero total_value.

from_timestamp, to_timestamp roughly matching last 24h.

Series:

GET /api/v1/timeseries/series?site_id=<site_id>&meter_id=<meter_id>&window_hours=24&resolution=hour


Expect:

24 hourly points with timestamps and values.

Export:

GET /api/v1/timeseries/export?site_id=<site_id>&meter_id=<meter_id>&window_hours=24


Expect:

CSV with timestamp_utc,site_id,meter_id,value.

6.2 Frontend checks (Dashboard + SiteView)

In the CEI UI:

Log in as the org admin.

Confirm the pilot site appears in Sites / SitesList.

Open the Site View:

The 24h / 7d charts should show recent data.

The KPI card should display last_24h_kwh and baseline_24h_kwh.

The baseline/forecast card should render with non-empty data.

Check Alerts and Reports:

Alerts: see if any baseline deviations are triggered.

Reports: ensure the 7-day table is populated and export works.

7. Monitoring & Troubleshooting
7.1 Factory side (client)

Check logs/output of factory_client.py:

Look at counts:

ingested

skipped_duplicate

failed

Inspect detailed errors (index, code, detail) when failed > 0.

Typical error patterns:

Auth issues:

401 / 403 – invalid or revoked CEI_INT_TOKEN.

Connectivity:

Timeouts, DNS issues – check network/firewall.

7.2 CEI backend logs

For each /timeseries/batch:

Log at least:

org_id

source

total_records

ingested

skipped_duplicate

failed

duration_ms

This allows quick back-of-envelope analysis of ingestion health.

8. Pilot Success Criteria

A pilot is considered successful when:

Data:

CEI has at least 2–4 weeks of timeseries coverage for the pilot site.

No major ingestion gaps (missed hours) without explanation.

Analytics:

Baseline vs actual charts are stable and interpretable.

Alerts and reports reflect real operational patterns (e.g. night/weekend waste, spikes).

Stakeholder value:

Plant/energy manager can identify at least 1–3 concrete actions to reduce energy waste.

CEI can estimate approximate savings in kWh and € for a realistic scenario.

At that point, you can move to:

Enabling more sites/meters.

Discussing production rollout and billing (Stripe integration, plan upgrades).

9. Related Documents

docs/directtimeseriesingestion.md
Detailed API contract for /api/v1/timeseries/batch (JSON schema, auth, examples).

docs/factory_client.py
Reference Python client with ramp + CSV modes.

scripts/run_factory_client.ps1
Windows Task Scheduler wrapper for hourly ingestion.


---

### Next move after you add this file

1. Create the file:

```powershell
# In repo root
notepad .\docs\pilot_runbook.md
# paste the content and save