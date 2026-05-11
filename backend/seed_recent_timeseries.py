"""
seed_recent_timeseries.py
--------------------------
Seeds 7 days of hourly kWh timeseries directly into the local DB
for Ceramica Rossi Srl (org_id=2) across site-1, site-2, site-3.

Each site has a distinct behavioral character so every card lights up:
  site-1 — wasteful: elevated night load + spikes → triggers night alerts
  site-2 — efficient: stable day load, very low nights → clean baseline
  site-3 — volatile: bad windows mid-week → drift detection fires

Safe to re-run: uses idempotency_key upsert (skips existing rows).

Run from: C:\\dev\\cei-mvp\\backend
Usage:
    python seed_recent_timeseries.py
    python seed_recent_timeseries.py --days 14
    python seed_recent_timeseries.py --days 7 --dry-run
"""
from __future__ import annotations

import argparse
import math
import random
import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy.exc import IntegrityError
from app.db.session import SessionLocal
from app.models import TimeseriesRecord

# ── Site profiles ─────────────────────────────────────────────────────────────

SITES = [
    {
        "site_id": "site-1",
        "org_id": 2,
        "meter_id": "meter-main-1",
        "regime": "wasteful",
        "day_base": 420.0,    # kWh/hour during the day
        "night_base": 95.0,   # kWh/hour at night (should be ~20% of day for a healthy plant)
        "sigma_day": 45.0,
        "sigma_night": 20.0,
        "weekend_factor": 0.30,
    },
    {
        "site_id": "site-2",
        "org_id": 2,
        "meter_id": "meter-main-1",
        "regime": "efficient",
        "day_base": 380.0,
        "night_base": 28.0,   # tight night baseline — efficient
        "sigma_day": 30.0,
        "sigma_night": 6.0,
        "weekend_factor": 0.12,
    },
    {
        "site_id": "site-3",
        "org_id": 2,
        "meter_id": "meter-main-1",
        "regime": "volatile",
        "day_base": 395.0,
        "night_base": 60.0,
        "sigma_day": 60.0,
        "sigma_night": 15.0,
        "weekend_factor": 0.40,
    },
]

# ── Value generation ──────────────────────────────────────────────────────────

def _daily_cycle(hour: int) -> float:
    """Smooth daily cycle — peaks ~13:00, troughs ~03:00. Returns 0.75..1.25."""
    angle = 2 * math.pi * ((hour - 13) / 24.0)
    return 1.0 + 0.25 * math.cos(angle)


def _is_weekend(dt: datetime) -> bool:
    return dt.weekday() >= 5  # Sat=5, Sun=6


def _gen_value(site: dict, ts: datetime, rng: random.Random) -> float:
    hour = ts.hour
    weekend = _is_weekend(ts)
    is_night = hour < 7 or hour >= 22

    base = site["night_base"] if is_night else site["day_base"]
    base *= _daily_cycle(hour)

    if weekend:
        base *= site["weekend_factor"]

    sigma = site["sigma_night"] if is_night else site["sigma_day"]
    value = base + rng.gauss(0, sigma)

    regime = site["regime"]

    if regime == "wasteful":
        # Night spikes — 15% chance per night hour (what the alert engine catches)
        if is_night and rng.random() < 0.15:
            value *= rng.uniform(2.0, 3.5)
        # Occasional daytime overconsumption
        if not is_night and rng.random() < 0.04:
            value *= rng.uniform(1.2, 1.5)

    elif regime == "efficient":
        # Very tight — just small noise
        value *= rng.uniform(0.96, 1.04)
        # Rare anomaly (1 in 500 hours)
        if rng.random() < 0.002:
            value *= rng.uniform(1.3, 1.6)

    elif regime == "volatile":
        # Mid-week bad windows (Tue/Wed/Thu)
        if ts.weekday() in (1, 2, 3):
            value *= rng.uniform(1.15, 1.40)
            if is_night and rng.random() < 0.08:
                value *= rng.uniform(1.5, 2.2)
        # Occasional dip (partial shutdown)
        if rng.random() < 0.006:
            value *= rng.uniform(0.20, 0.55)

    return float(max(0.0, min(value, 5000.0)))


# ── Main ──────────────────────────────────────────────────────────────────────

def run(days: int = 7, dry_run: bool = False) -> None:
    rng = random.Random(42)

    # End at the current hour (inclusive), start N days back
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=days)

    total_hours = int((now - start).total_seconds() // 3600) + 1

    print(f"Window : {start.isoformat()} → {now.isoformat()}")
    print(f"Hours  : {total_hours} per site × {len(SITES)} sites = {total_hours * len(SITES):,} records")
    print(f"Dry run: {dry_run}\n")

    db = SessionLocal()
    inserted = skipped = 0

    try:
        for site in SITES:
            site_inserted = site_skipped = 0
            print(f"── {site['site_id']} ({site['regime']}) ──")

            ts = start
            batch = []

            while ts <= now:
                value = _gen_value(site, ts, rng)
                idem_key = f"seed:local:{site['site_id']}:{site['meter_id']}:{ts.isoformat()}"

                record = TimeseriesRecord(
                    site_id=site["site_id"],
                    meter_id=site["meter_id"],
                    timestamp=ts,
                    value=round(value, 2),
                    unit="kWh",
                    organization_id=site["org_id"],
                    idempotency_key=idem_key,
                    source="seed_local",
                )
                batch.append(record)
                ts += timedelta(hours=1)

            if dry_run:
                print(f"  Would insert {len(batch)} records (dry run)")
                inserted += len(batch)
                continue

            # Batch insert with per-record duplicate handling
            for record in batch:
                try:
                    db.add(record)
                    db.flush()  # catch constraint violations immediately
                    site_inserted += 1
                except IntegrityError:
                    db.rollback()
                    site_skipped += 1
                except Exception as e:
                    db.rollback()
                    print(f"  ERROR on {record.timestamp}: {e}")
                    site_skipped += 1

            db.commit()
            inserted += site_inserted
            skipped += site_skipped
            print(f"  Inserted: {site_inserted:,}  Skipped (duplicate): {site_skipped:,}")

    except KeyboardInterrupt:
        db.rollback()
        print("\nInterrupted — partial work rolled back.")
    except Exception as e:
        db.rollback()
        print(f"\nFatal error: {e}")
        raise
    finally:
        db.close()

    print(f"\n{'─' * 50}")
    print(f"Total inserted : {inserted:,}")
    print(f"Total skipped  : {skipped:,}")
    if not dry_run:
        print("✅ Done — restart backend if it caches site lists.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed recent timeseries for local CEI testing")
    parser.add_argument("--days", type=int, default=7, help="Days of history to seed (default: 7)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    args = parser.parse_args()

    run(days=args.days, dry_run=args.dry_run)