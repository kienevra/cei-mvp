"""
Seed timeseries data for Ceramica Rossi Srl (org_id=2)
Sites: Plant A (site-1), Plant B (site-2), Plant C (site-3)

Generates 30 days of hourly data with realistic patterns + anomalies:
- Normal daytime production peaks (06:00-18:00)
- Lower weekend consumption
- Night waste spikes (triggers NIGHT_WASTE alert)
- Energy spikes (triggers SPIKE alert)
- Run: python seed_ceramica_rossi.py
"""
import json
import random
import math
from datetime import datetime, timedelta, timezone

# ── Config ────────────────────────────────────────────────────────────────────

API_BASE   = "http://localhost:8000/api/v1"
EMAIL      = "llpurpleberry@gmail.com"
PASSWORD   = "mypassword"

SITES = [
    {"id": "site-1", "name": "Plant A", "base_kwh": 120.0},
    {"id": "site-2", "name": "Plant B", "base_kwh": 85.0},
    {"id": "site-3", "name": "Plant C", "base_kwh": 55.0},
]

DAYS_BACK  = 90
BATCH_SIZE = 200   # records per POST

# ── Helpers ───────────────────────────────────────────────────────────────────

import urllib.request
import urllib.error

def api_post(path: str, payload: dict, token: str | None = None) -> dict:
    url  = f"{API_BASE}{path}"
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def login() -> str:
    import urllib.parse
    url  = f"{API_BASE}/auth/login"
    data = urllib.parse.urlencode({"username": EMAIL, "password": PASSWORD}).encode()
    req  = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def kwh_for_hour(base: float, dt: datetime, site_id: str) -> float:
    """
    Realistic hourly kWh with:
    - Diurnal curve (production 06-18)
    - Weekend reduction
    - Random noise
    - Injected anomalies for alerts
    """
    h   = dt.hour
    dow = dt.weekday()  # 0=Mon, 6=Sun

    # Diurnal factor: ramps up 06-09, plateau 09-17, ramps down 17-19
    if 6 <= h < 9:
        diurnal = 0.5 + (h - 6) / 3 * 0.5
    elif 9 <= h < 17:
        diurnal = 1.0
    elif 17 <= h < 19:
        diurnal = 1.0 - (h - 17) / 2 * 0.5
    elif 0 <= h < 5:
        diurnal = 0.08   # near-zero night baseline
    else:
        diurnal = 0.15

    # Weekend reduction
    weekend = 0.25 if dow >= 5 else 1.0

    value = base * diurnal * weekend

    # ── Inject anomalies ──────────────────────────────────────────────────────

    # Night waste: site-1, every Wednesday between 01:00-03:00
    # burns 4× normal night baseline → triggers NIGHT_WASTE
    if site_id == "site-1" and dow == 2 and 1 <= h <= 3:
        value = base * 0.6   # 60% of peak during night = waste

    # Spike: site-2, random days around 14:00 with 3× normal
    # → triggers SPIKE alert
    if site_id == "site-2" and h == 14:
        seed_val = int(dt.strftime("%Y%j"))  # deterministic per day
        if seed_val % 5 == 0:               # every ~5th day
            value = base * 3.2

    # Critical spike: site-1, last 3 days, hour 10 → critical alert
    now = datetime.now(timezone.utc)
    if site_id == "site-1" and (now - dt).days < 3 and h == 10:
        value = base * 4.5

    # Add ±8% noise
    value *= 1.0 + random.uniform(-0.08, 0.08)

    return round(max(value, 0.5), 3)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    random.seed(42)

    print("Logging in as Ceramica Rossi…")
    token = login()
    print(f"Token: {token[:20]}…")

    now   = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=41)  # fill the gap from ~41 days ago to now
    end   = now - timedelta(hours=1)  # seed right up to now

    for site in SITES:
        site_id   = site["id"]
        base_kwh  = site["base_kwh"]
        print(f"\nSeeding {site['name']} ({site_id}) — {DAYS_BACK * 24} records…")

        batch   = []
        total   = 0
        current = start

        while current <= end:
            batch.append({
                "site_id":   site_id,
                "timestamp": current.isoformat(),
                "value":     kwh_for_hour(base_kwh, current, site_id),
                "meter_id":  f"{site_id}-main",
            })
            current += timedelta(hours=1)

            if len(batch) >= BATCH_SIZE:
                result = api_post(
                    "/timeseries/batch",
                    {"records": batch},
                    token=token,
                )
                inserted = result.get("ingested", 0)
                total   += inserted
                print(f"  …{total} records inserted")
                batch = []

        # Flush remainder
        if batch:
            result = api_post(
                "/timeseries/batch",
                {"records": batch},
                token=token,
            )
            total += result.get("ingested", 0)

        print(f"  ✓ {site['name']}: {total} total records inserted")

    print("\nAll done. Run the alert engine to trigger notifications.")


if __name__ == "__main__":
    main()