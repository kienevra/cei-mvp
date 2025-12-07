# CEI Pilot Runbook – Factory Integration, Analytics & Operations

## Objective

Run a **4–8 week pilot with one factory** to validate that CEI can:

- Reliably ingest meter data (via **/timeseries/batch** and CSV)
- Compute statistical **baselines** and deviation KPIs
- Surface **anomalies and alerts** that match reality
- Quantify **% energy savings potential** and € impact
- Provide a clear, repeatable **operations workflow** for you and the plant

---

## 0. Backend readiness – automated test suite & health checks

Before doing anything with a real factory, confirm the backend is **green**.

### 0.1. Local environment

From your dev machine:

```bash
cd backend
Pre-conditions:

Python virtualenv active: .venv

backend/.env configured for local SQLite dev DB, for example:

env
Copy code
DATABASE_URL=sqlite:///../dev.db
SQLite file initialised via your helper (if not already):

bash
Copy code
python -m app.db.init_sqlite_db
0.2. Run the backend test suite
bash
Copy code
pytest
Expected outcome:

All 12 tests pass

No unexpected stack traces in output

What’s being exercised:

test_db_connection.py

Smoke-tests connectivity to DATABASE_URL.

tests/test_ingest.py

Validates CSV ingestion and direct /timeseries/batch JSON ingestion:

Happy-path ingest

Idempotent / deduplicated writes

Validation errors and structured error payloads

tests/test_analytics.py

Validates the analytics engine public surface:

AnalyticsService.compute_kpis (lightweight KPI shim)

Baseline / deviation logic

Anomaly detection hooks

tests/test_auth.py

Uses the test-only legacy shims in main.py:

/auth/signup

/auth/login

Confirms the auth stack is wired end-to-end for pilot usage (the real clients use /api/v1/auth/*).

tests/test_opportunities.py

Runs opportunity detection logic on a small fixture dataset.

If this is green, the core pipeline is trustworthy enough for a pilot.

0.3. Health endpoints
On a running backend instance (local or Render), validate:

API liveness

http
Copy code
GET /api/v1/health
DB readiness

http
Copy code
GET /api/v1/health/db
Ingestion completeness (data pipeline view)

http
Copy code
GET /api/v1/timeseries/ingest_health?window_hours=24
Example payload:

json
Copy code
{
  "window_hours": 24,
  "meters": [
    {
      "site_id": "site-1",
      "meter_id": "main-incomer",
      "window_hours": 24,
      "expected_points": 24,
      "actual_points": 23,
      "completeness_pct": 95.8,
      "last_seen": "2025-12-06T08:52:42Z"
    }
  ]
}
Interpretation:

expected_points: how many hourly points we expect in the window.

actual_points: how many we actually received.

completeness_pct: ingestion completeness KPI; for pilots, target ≥ 90–95% during normal operation.

last_seen: last successful ingest timestamp per meter.

If pytest passes and these endpoints return 200 OK with sensible payloads, the backend is pilot-ready.

1. Pilot scope & success criteria
1.1. Scope definition
Sites

1 factory, typically 1–3 logical site_ids
e.g. main plant, warehouse, utility yard.

Meters

Minimum: main incomer per site

Ideally: 2–5 key sub-meters:

Chillers

Compressors

HVAC

A critical process line

Data cadence

Hourly kWh values (one value per hour per meter)

History

Target: 30–90 days backfill via CSV or API (if available)

Ongoing: live hourly pushes going forward

1.2. Success metrics (hard)
The pilot is successful if:

CEI ingests >95% of expected hourly points over the pilot period

Data gap alarms / completeness issues affect < 2% of hours per site/meter

CEI identifies at least 3 actionable inefficiencies:

Night / weekend waste

Abnormal spikes

Elevated baseload vs baseline

You can articulate a clear narrative:

“CEI shows X–Y% avoidable kWh and €A–B/year savings potential”

2. Setup on CEI side
2.1. Create org + operator account
Create a dedicated org for the factory via signup or admin tooling.

Org name: e.g. Factory Org A – Pilot 2025

Primary operator user: e.g. energy.manager@clientdomain.com

This user is used for:

Checking dashboards (Dashboard, Sites, SiteView)

Reviewing Alerts and Reports

Managing Integration Tokens

2.2. Seed sites & meters
In CEI (seeding tools or admin):

For each physical site:

Create a site_id: e.g. site-22, site-101, etc.

Assign human label: e.g. Bologna Plant – Main Production.

Define expected meters per site:

Required: main-incomer

Optional (good for analytics): compressor-bank, chiller-01, hvac-floor1, etc.

Produce and share a mapping table with the client:

Physical site name	CEI site_id	Physical meter description	CEI meter_id
Bologna Plant – Main	site-22	Main incomer MCC	main-incomer
Bologna Plant – Main	site-22	Compressor bank	compressor-bank
Warehouse A	site-23	Warehouse incomer	main-incomer

This table is the single source of truth during integration.

3. Integration token provisioning
3.1. Create integration token (per factory org)
Logged in as the operator user in the factory org:

Go to Settings → Integration Tokens.

Click Create integration token.

Name it clearly: e.g. factory-scada-main-plant.

Copy the plaintext token once (it will not be shown again).

Share it with the client over a secure channel.

The client must configure:

CEI_BASE_URL
e.g. https://cei-backend.onrender.com (or your actual Render URL)

CEI_INT_TOKEN
the cei_int_... token you just generated

Tokens are org-scoped: any data ingested with this token is restricted to that org.

4. Data model & API contract (summary)
For details, use docs/directtimeseriesingestion.md. For the runbook, operators only need the high-level view.

4.1. Endpoint
http
Copy code
POST /api/v1/timeseries/batch
Authorization: Bearer <CEI_INT_TOKEN>
Content-Type: application/json
4.2. Record schema (per point)
json
Copy code
{
  "site_id": "site-22",
  "meter_id": "main-incomer",
  "timestamp_utc": "2025-12-05T13:00:00Z",
  "value": 152.3,
  "unit": "kWh",
  "idempotency_key": "site-22|main-incomer|2025-12-05T13:00:00Z"
}
Rules:

site_id

Must match a CEI site (site-22, site-101, etc.)

meter_id

Short stable ID (e.g. main-incomer, compressor-bank)

timestamp_utc

ISO8601, UTC, Z-suffixed

Represents the end of the interval for hourly data

value

Numeric kWh for that hour

unit

"kWh" (or omitted if defaulted)

idempotency_key

Stable per site/meter/hour to make retries safe
Recommended pattern: "{site_id}|{meter_id}|{timestamp_utc}"

4.3. Response (example)
json
Copy code
{
  "total_records": 120,
  "ingested": 118,
  "skipped_duplicate": 2,
  "failed": 0,
  "errors": []
}
skipped_duplicate confirms idempotency is working.

If failed > 0, errors contains structured reasons per record.

5. Integration modes
5.1. Direct API mode (preferred)
The client’s SCADA/BMS/historian or data warehouse pushes hourly data directly to /timeseries/batch from their environment (Python, Node, etc.).

Deliverables:

A small script running close to the data (on-prem or near the historian), built using your docs/factory_client.py pattern.

A cron job / Windows Task Scheduler entry (every 5–15 minutes) that:

Pulls the last hour’s data from SCADA/historian.

Transforms into CEI’s JSON schema.

POSTs to /timeseries/batch.

5.2. CSV bootstrap mode (initial backfill)
For historical data:

The client exports CSV from SCADA/historian with columns:

text
Copy code
site_id, meter_id, timestamp_utc, value, unit
You use CEI’s existing CSV upload flow:

Via UI (CSVUpload page), or

via backend /upload-csv endpoint.

This is ideal to backfill 30–90 days; once backfill is done, you rely on direct API mode for ongoing data.

6. Verify data completeness with ingest health
Once the factory client is pushing data, use ingest health to quickly validate that the pipeline is sane.

6.1. Backend API – /api/v1/timeseries/ingest_health
Method: GET

Path: /api/v1/timeseries/ingest_health

Auth: same org-scope model as /timeseries/batch

Query params:

window_hours (int, required) – typically 24 or 168

Example (PowerShell, local dev):

powershell
Copy code
$token = "<your_pilot_access_token>"
$authHeader = "Bearer $token"

$health = Invoke-RestMethod `
  -Method GET `
  -Uri "http://127.0.0.1:8000/api/v1/timeseries/ingest_health?window_hours=24" `
  -Headers @{ Authorization = $authHeader }

$health
$health.meters | Format-Table site_id, meter_id, expected_points, actual_points, completeness_pct, last_seen
Key checks per meter:

completeness_pct for last 24h

last_seen within the last 1–2 hours

expected_points vs actual_points matches your configured cadence

6.2. Frontend ingestion health widget
In the frontend you have:

ts
Copy code
export interface IngestHealthMeter {
  site_id: string;
  meter_id: string;
  window_hours: number;
  expected_points: number;
  actual_points: number;
  completeness_pct: number;
  last_seen: string; // ISO timestamp
}

export interface IngestHealthResponse {
  window_hours: number;
  meters: IngestHealthMeter[];
}

export async function getIngestHealth(
  windowHours: number = 24
): Promise<IngestHealthResponse> {
  const res = await api.get<IngestHealthResponse>(
    "/timeseries/ingest_health",
    {
      params: { window_hours: windowHours },
    }
  );
  return res.data;
}
You can surface this in:

A small data-health chip on Dashboard or SiteView, or

A dedicated Ingestion Health section/page for operators.

For the pilot, it’s enough that you can call getIngestHealth and visually see:

Which meters are healthy

Which meters have gaps

Whether completeness is good enough for analytics to be trusted

7. Pilot onboarding workflow (step-by-step)
7.1. Preparation (CEI side)
 Create org + operator user dedicated to the pilot.

 Configure site_ids and meter_ids and share the mapping table.

 Generate an integration token for that org.

 Prepare:

docs/directtimeseriesingestion.md

This docs/pilot_runbook.md

One or two sample JSON payloads and test commands (curl / PowerShell).

7.2. Kickoff with client (60–90 min)
Agenda:

Explain what CEI needs

Hourly kWh per site_id / meter_id

UTC timestamps

Stable IDs

Review mapping table

Confirm the sites and meters match how they think about the plant.

Hand over integration details

CEI_BASE_URL

CEI_INT_TOKEN

site_id / meter_id mapping

Decide integration mode

Direct API from SCADA/historian?

Or CSV export + small relay script using /timeseries/batch?

7.3. Technical integration (client’s action items)
Client engineers:

Implement a small client:

Start from your docs/factory_client.py template.

Replace the “ramp” or CSV stub with real data pulls from SCADA/historian.

Configure environment:

CEI_BASE_URL

CEI_INT_TOKEN

Any SCADA connection parameters.

Run a one-off test:

Ingest 1–2 hours for one meter.

Confirm CEI response contains:

json
Copy code
{ "ingested": 1, "skipped_duplicate": 0, "failed": 0, "errors": [] }
Turn on a scheduled job:

Every 5–15 minutes:

Look back one or two hours.

Pull any new readings.

Send them to /timeseries/batch.

8. Validation: end-to-end pipeline sanity
Once data is flowing, you verify from both the API and the UI.

8.1. Ingestion checks (API level)
Hit /api/v1/timeseries/summary and /api/v1/timeseries/series with site_id / meter_id:

Confirm last 24h show non-zero points and sensible totals.

Use /api/v1/timeseries/export:

Pull CSV for the pilot site/meter for last few days.

Ask the client for a SCADA export for the same window.

Spot-check:

Timestamps align hour-for-hour.

Values match (allowing for rounding or aggregation differences).

8.2. Frontend checks (operator level)
In CEI UI:

Dashboard

Last 24h card shows reasonable totals for the pilot site(s).

No obviously insane values.

SitesList

Pilot site appears.

Baseline deviation pill shows neutral/positive/negative in a way that makes sense once enough history exists.

SiteView

24h trend chart is populated and smooth.

KPI snapshot (24h vs baseline, 7d vs previous 7d) shows plausible numbers.

Baseline profile text describes realistic mean / p50 / p90.

Forecast strip (stub) matches the rough shape of recent 24h.

Hybrid narrative card gives a coherent story (not nonsense).

Site alerts strip shows local alerts when rules trigger.

Site timeline (if wired to /site-events) shows:

Ingestion windows

Alert windows

Alerts page

Night vs day, weekend vs weekday, and spike alerts start appearing for the pilot site.

Severity (warning / critical) aligns with reality.

Reports page

7-day tables make sense once a week of data is present.

CSV exports open cleanly and match what you see in the charts.

If any of these look off, check:

Ingested timestamps (local vs UTC confusion)

Whether they’re sending cumulative energy instead of interval (or vice versa)

Unit mistakes (kW vs kWh)

9. Operations during the pilot
9.1. Monitoring ingestion health
Initial manual practice:

Daily

Check /timeseries/ingest_health?window_hours=24:

completeness_pct ≥ 90–95% for key meters

last_seen < 2 hours old

If completeness is low:

Check factory client logs

Confirm SCADA export job is running

Check network / firewall issues toward CEI

Weekly

Use /timeseries/export for last 7 days for key meters.

Compare with SCADA export to ensure no silent drift.

The frontend ingestion-health widget (powered by getIngestHealth) should be used by you to quickly see red vs green meters during the pilot.

9.2. Alerts and anomaly tracking
During the pilot:

Use the Alerts page + SiteView to triage:

Night-load alerts

Weekend-load alerts

Spike alerts

Baseline deviation alerts

Track each meaningful alert in a simple spreadsheet or notes doc:

site_id, meter_id

Rule type (night, weekend, spike, baseline)

Estimated wasted kWh / € impact

Root cause (once confirmed):
e.g. “compressor left on idle“, “HVAC schedule bug”, “extra shift run late”

9.3. Site events & timeline
The Site Timeline (driven by /site-events) aggregates:

Ingestion events for a site (windows where data arrived)

Alert events fired for that site

Use this in weekly reviews to anchor the conversation:

“Here’s when ingestion started / resumed.”

“Here are the alert windows where CEI flagged waste.”

“Here’s how those align with your reported maintenance / operational changes.”

(Manual “note” events are a natural next iteration – for now, you can track narrative notes separately in your report or spreadsheet.)

10. Weekly review cadence
Every week with the client:

Ingestion report

Data completeness for each key meter (completeness_pct from ingest_health)

Any ingestion errors or gaps with root cause status

Insights & actions

New alerts triggered, especially repeated ones

Specific anomalies and hypotheses from SiteView (baseline vs actual, spikes, hybrid narrative)

Actions taken

Document operational changes: schedule tweaks, shutdown procedures, parameter changes

Link back to the SiteView/Timeline time windows

Impact tracking

Rough estimate of avoided energy (kWh & €) using:

Baseline vs actual from KPIs / insights

Client’s tariff assumptions

Next week’s focus

Which meters or lines to drill into next

Any additional data sources (more meters, temperatures, production counts)

11. Pilot close-out
At the end of 4–8 weeks, deliver a concise Pilot Report:

Data coverage

Completeness achieved for each key meter

Duration of stable data (e.g. 6 weeks of clean hourly data)

Key findings

Night/weekend baseload issues

Spikes around start-up/shutdown

Sites/machines with persistent over-baseline usage

Actions and outcomes

Operational changes recommended

Changes implemented during pilot

Early impact indicators (kWh and €)

Savings narrative

Estimated % of avoidable kWh

Estimated € savings per year

Payback potential vs CEI cost

Decision gates

Extend pilot to more sites/meters

Move to paid subscription / full rollout

Park or pivot if data or organizational readiness isn’t there yet

This runbook, your direct ingestion docs, and the CEI UI (Dashboard, Sites, SiteView, Alerts, Reports, Timeline) together form the standard operating playbook for running and scaling early pilots.

makefile
Copy code
::contentReference[oaicite:0]{index=0}