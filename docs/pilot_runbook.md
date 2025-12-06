CEI Pilot Runbook – Factory Integration & Operations

Objective:
Run a 4–8 week pilot with one factory to validate that CEI can reliably ingest meter data, compute baselines, surface anomalies, and quantify % energy savings potential.

1. Pilot scope & success criteria
1.1 Scope definition

Sites: 1 factory, 1–3 logical site_ids (e.g. main plant + warehouse).

Meters:

At minimum: main-incomer per site.

Ideally: 2–5 key sub-meters (chillers, compressors, HVAC, process line).

Data cadence: hourly kWh values.

History:

Target: last 30–90 days (if available) via CSV/API.

Ongoing: live hourly pushes.

1.2 Success metrics (hard)

CEI ingests > 95% of expected hourly points over the pilot period.

Data gap alarms < 2% of hours (per site/meter).

CEI identifies at least 3 actionable inefficiencies (night/weekend waste, abnormal spikes, poor baseload, etc.).

Clear narrative: “CEI shows X–Y% avoidable kWh and €A–B per year savings potential.”

2. Setup on CEI side
2.1 Create org + operator account

Create the factory org in CEI (via signup or admin tooling).

Define:

organization_name (e.g. “Factory Org A – Pilot 2025”)

Primary operator user: factory-operator@clientdomain.com

Operator user is used only for:

Checking dashboards, alerts, reports.

Creating integration tokens.

2.2 Seed sites & meters

In CEI admin/backoffice (or via your existing seeding tools):

For each physical site:

Create site_id like site-XX (document in a mapping table you’ll send to the client).

Add human labels (e.g. “Bologna Plant – Main Production”).

Define expected meters per site:

main-incomer (required)

Optional: compressor-bank, chiller-01, hvac-floor1, etc.

Deliverable to client: “CEI Integration Mapping” table:

Physical site name	CEI site_id	Physical meter description	CEI meter_id
Bologna Plant – Main	site-22	Main incomer MCC	main-incomer
Bologna Plant – Main	site-22	Compressor bank	compressor-bank
Warehouse A	site-23	Warehouse incomer	main-incomer
3. Integration token provisioning
3.1 Create integration token

Logged in as the operator user (e.g. factory-operator@cei.local or their real email):

Go to Settings → Integration tokens (your existing UI).

Create a new token:

Name: factory-scada-line1 (or similar).

Scope: bound to the factory org (implicit in your current model).

Copy the plaintext (cei_int_…) and give it once to the client (encrypted channel ideally).

Client must store:

CEI_BASE_URL (e.g. https://cei-mvp.onrender.com)

CEI_INT_TOKEN = cei_int_…

4. Data model & API contract (quick recap)

Use the doc you already wrote (directtimeseriesingestion.md) as the deep dive. For the runbook, keep the operator summary:

Endpoint: POST /api/v1/timeseries/batch

Auth: Authorization: Bearer cei_int_…

Record schema:

{
  "site_id": "site-22",
  "meter_id": "main-incomer",
  "timestamp_utc": "2025-12-05T13:00:00Z",
  "value": 152.3,
  "unit": "kWh",
  "idempotency_key": "site-22-main-incomer-2025-12-05T13:00:00Z"
}


Rules:

timestamp_utc: UTC, ISO8601, Z-suffixed.

value: numeric kWh, one value per hour per meter.

unit: must be "kWh" (or omitted).

idempotency_key: stable per site/meter/hour to make retries safe.

5. Integration modes
5.1 Direct API mode (preferred)

Client’s SCADA/BMS/historian pushes hourly data directly to /timeseries/batch from their environment (Python, Node, etc.), using the schema above.

Deliverables:

A small Python (or Node) script in their environment, built from your docs/factory_client.py pattern.

A cron / Windows Task Scheduler job (every 5–15 min) that:

Pulls last hour’s data from SCADA.

Transforms to CEI schema.

POSTs it to /timeseries/batch.

5.2 CSV bootstrap mode (initial backfill)

For history, they can:

Export CSV from SCADA/historian with columns:

site_id, meter_id, timestamp_utc, value, unit

Use your existing upload CSV flow (UI or API) to ingest historical data in bulk.

This is already wired into CEI; this runbook just states: “For history, we may use CSV mode first, then switch to live API mode.”

6. Pilot onboarding workflow (step-by-step)
6.1 Preparation (CEI side)

Create org + operator user.

Configure site_ids and meter_ids.

Generate integration token, store ID and expiry policy in your internal sheet.

Prepare:

directtimeseriesingestion.md

This pilot_runbook.md

A sample payload JSON and test commands.

6.2 Kickoff with client

In a 60–90 minute working session:

Explain:

What CEI needs: hourly kWh per site/meter.

KPI: data completeness, stable ingestion.

Review mapping table and confirm all meters.

Hand over credentials:

CEI_BASE_URL

CEI_INT_TOKEN

site_id / meter_id table

Decide integration mode:

Direct API from SCADA?

Or export to CSV + a small relay script?

6.3 Technical integration (client’s action items)

Client engineers:

Implement the small script:

Use your docs/factory_client.py as a template.

Replace fake ramp logic with their real data source.

Configure environment:

Set CEI_BASE_URL, CEI_INT_TOKEN, and any SCADA connection params.

Run a one-off test:

Ingest a single hour for a single meter.

Verify response: {"ingested":1,"skipped_duplicate":0,"failed":0,"errors":[]}.

Turn on scheduled job at desired cadence (e.g. every 15 min).

7. Validation: does the pipeline actually work?
7.1 Ingestion checks

On your side:

Hit /api/v1/timeseries/summary and /series for the relevant site_id/meter_id:

Check that the last 24h show non-zero points.

Use the existing /timeseries/export to pull CSV and spot-check:

Timestamps align with their expected hours.

Values match one-to-one with SCADA exports.

7.2 Frontend checks

In CEI UI:

Dashboard:

Last 24 h card shows reasonable totals for the pilot site(s).

SiteView:

Trend chart populated with recent hours.

Baseline/forecast cards not obviously broken by new data.

Alerts:

Night/weekend/spike alerts begin to populate after some data accumulates.

Reports:

7-day tables make sense once a week of data is in.

8. Operations during the pilot
8.1 Monitoring ingestion health (manual v1)

Until you build a dedicated ingestion-health page, do this:

Daily checks:

/timeseries/summary?site_id=...&window_hours=24 – confirm points match 24 (main incomer).

If points << 24, coordinate with client to check SCADA job logs.

Weekly:

/timeseries/export over last 7 * 24 hours and compare with a SCADA export.

You can later formalize this as:

A dedicated endpoint like /analytics/ingest-metrics summarizing:

Last_seen_timestamp per meter.

% completeness in last 24h / 7d.

Error counts per code (INVALID_UNIT, ORG_MISMATCH, etc.).

8.2 Alert and anomaly tracking

During the pilot:

Tag each alert or anomaly with:

site_id, meter_id

Rule type (night-load, weekend-load, spike, baseline deviation)

Estimated wasted kWh / € impact

Root cause once known (e.g. compressor left on idle, HVAC scheduling, process drift)

Maintain this in a simple spreadsheet for now.

9. Weekly review cadence

Every week with the client:

Ingestion report

Data completeness (% of expected points).

Any ingestion errors (by TimeseriesIngestErrorCode).

Insights & actions

New alerts triggered.

Confirmed issues and remedial actions.

Impact tracking

Rough estimate of avoided energy (kWh & €) from changes already made.

Next week’s focus

Which meters or lines to drill into next.

10. Pilot close-out

At the end of 4–8 weeks:

Deliver a short written Pilot Report:

Data coverage achieved.

Key anomalies found.

Operational changes recommended / implemented.

Estimated savings potential and payback.

Decision gates:

Extend pilot to more sites/meters.

Move to paid subscription / full rollout.

Park or pivot.