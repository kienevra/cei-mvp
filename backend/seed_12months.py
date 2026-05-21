"""
Seed 12 months of hourly timeseries data for Ceramica Rossi Srl (org_id=2)
Sites: Plant A (site-1), Plant B (site-2), Plant C (site-3)

Features:
- 365 days of hourly data (~8,760 records per site)
- Seasonal variation: higher summer (cooling) + winter (heating)
- Monthly efficiency improvement trend (EnPI improves ~8% over the year)
- Realistic diurnal curve + weekend reduction
- Night waste anomalies (Wednesday 01-03h, site-1)
- Demand spikes (site-2, ~every 5th day at 14h)
- Critical spikes in last 3 days (site-1, 10h)
- ±8% noise for realism

Run:
    cd C:\\dev\\cei-mvp\\backend
    .venv\\Scripts\\python seed_12months.py
"""
import json
import math
import random
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# ── Config ──────────────────────────────────────────────────────────────────

API_BASE   = "http://localhost:8000/api/v1"
EMAIL      = "llpurpleberry@gmail.com"
PASSWORD   = "mypassword"

SITES = [
    {"id": "site-1", "name": "Plant A", "base_kwh": 120.0},
    {"id": "site-2", "name": "Plant B", "base_kwh": 85.0},
    {"id": "site-3", "name": "Plant C", "base_kwh": 55.0},
]

DAYS_BACK  = 365
BATCH_SIZE = 200

# ── Helpers ──────────────────────────────────────────────────────────────────

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
    url  = f"{API_BASE}/auth/login"
    data = urllib.parse.urlencode(
        {"username": EMAIL, "password": PASSWORD}
    ).encode()
    req  = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def seasonal_factor(dt: datetime) -> float:
    """
    Simulate seasonal energy demand:
    - Peak in July–August (cooling load): +20%
    - Peak in December–January (heating):  +15%
    - Trough in April–May (mild spring):   -10%
    Uses a double-cosine curve for smooth transitions.
    """
    # Day of year 0–364 mapped to 0–2π
    day_of_year = dt.timetuple().tm_yday
    angle = 2 * math.pi * day_of_year / 365

    # Summer peak around day 200 (mid-July), winter peak around day 355 (Dec)
    summer = 0.10 * math.cos(angle - 2 * math.pi * 200 / 365)
    winter = 0.08 * math.cos(angle - 2 * math.pi * 355 / 365)

    # Combined: ranges roughly -0.10 to +0.20
    return 1.0 + summer + winter


def efficiency_factor(dt: datetime, start_dt: datetime) -> float:
    """
    Simulate a gradual 8% efficiency improvement over 12 months.
    Month 0 = 1.0 (baseline), Month 12 = 0.92 (8% reduction in kWh/unit).
    This makes the EnPI baseline-vs-current comparison meaningful.
    """
    days_elapsed = (dt - start_dt).days
    improvement_rate = 0.08 / 365          # 8% over the full year
    return max(0.92, 1.0 - improvement_rate * days_elapsed)


def kwh_for_hour(
    base: float,
    dt: datetime,
    site_id: str,
    start_dt: datetime,
) -> float:
    """
    Realistic hourly kWh with:
    - Diurnal production curve (06:00–18:00)
    - Weekend reduction
    - Seasonal variation
    - Gradual efficiency improvement trend
    - Injected anomalies for alert testing
    - ±8% random noise
    """
    h   = dt.hour
    dow = dt.weekday()          # 0=Mon … 6=Sun

    # ── Diurnal curve ─────────────────────────────────────────────────────
    if 6 <= h < 9:
        diurnal = 0.5 + (h - 6) / 3 * 0.5     # ramp up
    elif 9 <= h < 17:
        diurnal = 1.0                            # production peak
    elif 17 <= h < 19:
        diurnal = 1.0 - (h - 17) / 2 * 0.5     # ramp down
    elif 0 <= h < 5:
        diurnal = 0.08                           # near-zero night
    else:
        diurnal = 0.15                           # early morning / late evening

    # ── Weekend reduction ─────────────────────────────────────────────────
    weekend = 0.25 if dow >= 5 else 1.0

    # ── Base value with seasonal + efficiency modifiers ───────────────────
    value = (
        base
        * diurnal
        * weekend
        * seasonal_factor(dt)
        * efficiency_factor(dt, start_dt)
    )

    # ── Injected anomalies ────────────────────────────────────────────────

    # Night waste: site-1, every Wednesday 01:00–03:00
    # → triggers NIGHT_WASTE alert
    if site_id == "site-1" and dow == 2 and 1 <= h <= 3:
        value = base * 0.6

    # Demand spike: site-2, deterministic ~every 5th day at 14:00
    # → triggers SPIKE alert
    if site_id == "site-2" and h == 14:
        seed_val = int(dt.strftime("%Y%j"))
        if seed_val % 5 == 0:
            value = base * 3.2

    # Critical spike: site-1, last 3 days, hour 10
    # → triggers CRITICAL alert
    now = datetime.now(timezone.utc)
    if site_id == "site-1" and (now - dt).days < 3 and h == 10:
        value = base * 4.5

    # ── Noise ─────────────────────────────────────────────────────────────
    value *= 1.0 + random.uniform(-0.08, 0.08)

    return round(max(value, 0.5), 3)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    random.seed(42)

    print("Logging in as Ceramica Rossi…")
    token = login()
    print(f"  Token: {token[:20]}…\n")

    now       = datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    )
    start_dt  = now - timedelta(days=DAYS_BACK)
    end_dt    = now - timedelta(hours=1)

    total_hours = DAYS_BACK * 24
    print(f"Seeding {DAYS_BACK} days ({total_hours:,} hours) per site…\n")

    for site in SITES:
        site_id  = site["id"]
        base_kwh = site["base_kwh"]
        print(f"  ▶  {site['name']} ({site_id})")

        batch   = []
        total   = 0
        current = start_dt

        while current <= end_dt:
            batch.append({
                "site_id":   site_id,
                "timestamp": current.isoformat(),
                "value":     kwh_for_hour(base_kwh, current, site_id, start_dt),
                "meter_id":  f"{site_id}-main",
            })
            current += timedelta(hours=1)

            if len(batch) >= BATCH_SIZE:
                result   = api_post("/timeseries/batch", {"records": batch}, token=token)
                inserted = result.get("ingested", 0)
                total   += inserted
                if total % 2000 == 0 or total == inserted:
                    print(f"     …{total:,} records inserted")
                batch = []

        # Flush remainder
        if batch:
            result  = api_post("/timeseries/batch", {"records": batch}, token=token)
            total  += result.get("ingested", 0)

        print(f"     ✓ {site['name']}: {total:,} records total\n")

    print("=" * 56)
    print("Seeding complete.")
    print()
    print("Useful test windows:")
    baseline_start = (now - timedelta(days=365)).strftime("%Y-%m-%d")
    baseline_end   = (now - timedelta(days=183)).strftime("%Y-%m-%d")
    current_start  = (now - timedelta(days=182)).strftime("%Y-%m-%d")
    current_end    = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    period_start   = (now - timedelta(days=90)).strftime("%Y-%m-%d")
    today          = now.strftime("%Y-%m-%d")
    year           = now.year

    print(f"  MRV / Correlation period_start : {period_start}")
    print(f"  MRV / Correlation period_end   : {today}")
    print(f"  EnPI baseline_start            : {baseline_start}")
    print(f"  EnPI baseline_end              : {baseline_end}")
    print(f"  EnPI current_start             : {current_start}")
    print(f"  EnPI current_end               : {current_end}")
    print(f"  ETS year                       : {year}")
    print()
    print("Run alert engine to trigger notifications.")


if __name__ == "__main__":
    main()