"""
CEI — Topup seed script for Ceramica Rossi Srl
Adds:
  1. Timeseries from last known timestamp to now
  2. Daily production records (units produced) for all 3 sites

Usage (from C:\\dev\\cei-mvp\\backend):
    python seed_topup.py
"""

import requests
import random
import math
import csv
import io
from datetime import datetime, timedelta, timezone, date

API_BASE          = "https://api.carbonefficiencyintel.com/api/v1"
INTEGRATION_TOKEN = "cei_int_kf77jzYyIG_AfNKoZ10fu2QyqlnUnIe44rBRMwD0OOk"
METER_ID          = "main-meter"

def efficient_kwh(hour, day_of_week):
    is_weekend = day_of_week >= 5
    if is_weekend:
        return max(20, 30 + random.gauss(0, 3))
    if 7 <= hour < 18:
        peak = 180 * math.exp(-0.5 * ((hour - 12) / 4) ** 2)
        return max(40, peak + random.gauss(0, 8))
    elif 6 <= hour < 7 or 18 <= hour < 20:
        return 70 + random.gauss(0, 6)
    else:
        return 38 + random.gauss(0, 4)

def wasteful_kwh(hour, day_of_week):
    base = 120 + random.gauss(0, 12)
    if 8 <= hour < 17:
        production = 200 + random.gauss(0, 25)
    elif 17 <= hour < 22:
        production = 160 + random.gauss(0, 20)
    else:
        production = base + random.gauss(0, 15)
    if random.random() < 0.10:
        production += random.uniform(60, 140)
    return max(80, base + production * 0.6)

def fluctuating_kwh(hour, day_of_week, day_index):
    week = (day_index // 7) % 2
    if week == 0:
        return efficient_kwh(hour, day_of_week) * random.uniform(0.95, 1.10)
    else:
        return wasteful_kwh(hour, day_of_week) * random.uniform(0.90, 1.05)

def efficient_production(day_of_week):
    if day_of_week >= 5:
        return 0
    return round(random.gauss(850, 50))

def wasteful_production(day_of_week):
    if day_of_week >= 5:
        return round(random.gauss(400, 80))
    return round(random.gauss(1100, 120))

def fluctuating_production(day_of_week, day_index):
    if day_of_week >= 5:
        return 0
    week = (day_index // 7) % 2
    if week == 0:
        return round(random.gauss(900, 60))
    else:
        return round(random.gauss(700, 100))

def upload_timeseries(headers, site_id, site_name, generator_fn, start, end):
    records = []
    current = start
    day_index = 0
    while current <= end:
        value = round(generator_fn(current.hour, current.weekday(), day_index), 2)
        records.append({
            "site_id":   f"site-{site_id}",
            "meter_id":  METER_ID,
            "timestamp": current.isoformat(),
            "value":     value,
            "unit":      "kWh",
        })
        current += timedelta(hours=1)
        if current.hour == 0:
            day_index += 1

    if not records:
        print(f"  {site_name}: no new timeseries records needed")
        return 0

    total_uploaded = 0
    for i in range(0, len(records), 500):
        batch = records[i:i+500]
        r = requests.post(
            f"{API_BASE}/timeseries/batch",
            headers=headers,
            json={"records": batch},
        )
        if r.status_code in (200, 201):
            total_uploaded += len(batch)
        else:
            print(f"    WARNING timeseries: {r.status_code} {r.text[:200]}")

    print(f"  {site_name}: {total_uploaded} timeseries records ({start.date()} to {end.date()})")
    return total_uploaded

def upload_production(headers, site_id, site_name, prod_generator_fn, start_date, end_date):
    rows = []
    current = start_date
    day_index = 0
    while current <= end_date:
        units = prod_generator_fn(current.weekday(), day_index)
        if units > 0:
            rows.append({
                "date": current.isoformat(),
                "units_produced": units,
                "unit_label": "pezzi",
            })
        current += timedelta(days=1)
        day_index += 1

    if not rows:
        print(f"  {site_name}: no production records to upload")
        return 0

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["date", "units_produced", "unit_label"])
    writer.writeheader()
    writer.writerows(rows)
    csv_bytes = buf.getvalue().encode("utf-8")

    r = requests.post(
        f"{API_BASE}/analytics/sites/site-{site_id}/production-upload",
        headers=headers,
        files={"file": (f"production_site{site_id}.csv", csv_bytes, "text/csv")},
    )

    if r.status_code in (200, 201):
        result = r.json()
        inserted = result.get("inserted", 0)
        updated  = result.get("updated", 0)
        print(f"  {site_name}: {inserted} inserted + {updated} updated production records")
        return inserted + updated
    else:
        print(f"    WARNING production: {r.status_code} {r.text[:300]}")
        return 0

def main():
    random.seed(99)
    headers = {"Authorization": f"Bearer {INTEGRATION_TOKEN}"}

    r = requests.get(f"{API_BASE}/sites/", headers=headers)
    r.raise_for_status()
    sites = sorted(r.json(), key=lambda s: s["id"])
    print(f"Connected — found {len(sites)} sites\n")

    site1, site2, site3 = sites[0], sites[1], sites[2]

    # Timeseries topup
    ts_start = datetime(2026, 5, 25, 17, 0, 0, tzinfo=timezone.utc)
    ts_end   = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    print(f"Topping up timeseries from {ts_start} to {ts_end}")
    print(f"Hours to fill: {int((ts_end - ts_start).total_seconds() / 3600)}\n")

    ts_generators = {
        site1["id"]: (site1["name"], lambda h, d, i: efficient_kwh(h, d)),
        site2["id"]: (site2["name"], lambda h, d, i: wasteful_kwh(h, d)),
        site3["id"]: (site3["name"], fluctuating_kwh),
    }

    ts_total = 0
    for site_id, (site_name, gen_fn) in ts_generators.items():
        ts_total += upload_timeseries(headers, site_id, site_name, gen_fn, ts_start, ts_end)

    # Production data — 60 days history
    prod_end   = date.today()
    prod_start = prod_end - timedelta(days=60)

    print(f"\nUploading production data from {prod_start} to {prod_end}\n")

    prod_generators = {
        site1["id"]: (site1["name"], lambda d, i: efficient_production(d)),
        site2["id"]: (site2["name"], lambda d, i: wasteful_production(d)),
        site3["id"]: (site3["name"], fluctuating_production),
    }

    prod_total = 0
    for site_id, (site_name, gen_fn) in prod_generators.items():
        prod_total += upload_production(
            headers, site_id, site_name, gen_fn, prod_start, prod_end
        )

    print(f"\nTimeseries records uploaded: {ts_total}")
    print(f"Production records uploaded:  {prod_total}")
    print("Topup complete ✓")

if __name__ == "__main__":
    main()