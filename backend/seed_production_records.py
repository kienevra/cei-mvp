"""
seed_production_records.py
--------------------------
Seeds 90 days of daily production data for Ceramica Rossi Srl (org_id=2)
across site-1, site-2, site-3.

Unit: pezzi (ceramic pieces)
Run from: C:\\dev\\cei-mvp\\backend

Usage:
    python seed_production_records.py
    python seed_production_records.py --days 60
    python seed_production_records.py --dry-run
"""
import argparse
import random
import sys
from datetime import date, timedelta

# ── Bootstrap the backend so we can reuse app DB settings ──────────────────
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.db.session import SessionLocal
from app.models import ProductionRecord

# ── Site config ─────────────────────────────────────────────────────────────
# Each site has a realistic daily baseline and variability profile.
# Ceramica Rossi is a mid-size ceramic tile plant.
SITES = [
    {
        "site_id": 1,
        "organization_id": 2,
        "label": "site-1 (Main Kiln Line)",
        "unit_label": "pezzi",
        "base_units": 4800,    # pieces/day at full capacity
        "std_units": 420,      # daily variation
        "weekend_factor": 0.0, # fully closed weekends
    },
    {
        "site_id": 2,
        "organization_id": 2,
        "label": "site-2 (Glazing & Finishing)",
        "unit_label": "pezzi",
        "base_units": 4200,
        "std_units": 380,
        "weekend_factor": 0.0,
    },
    {
        "site_id": 3,
        "organization_id": 2,
        "label": "site-3 (Packaging & Dispatch)",
        "unit_label": "pezzi",
        "base_units": 3900,
        "std_units": 300,
        "weekend_factor": 0.15,  # skeleton crew on Saturdays
    },
]

# ── Realistic anomaly injection ──────────────────────────────────────────────
# A few days where production dropped but energy stayed high (maintenance, startup)
# These should show up as anomalies in the correlation endpoint.
ANOMALY_DAYS_OFFSET = {15, 16, 42, 43, 71}  # days offset from start_date


def generate_production(site: dict, d: date, day_offset: int, rng: random.Random) -> float:
    """Return a realistic units_produced value for a given day."""
    weekday = d.weekday()  # 0=Mon, 6=Sun

    # Weekend handling
    if weekday == 6:  # Sunday — always closed
        return 0.0
    if weekday == 5:  # Saturday
        if site["weekend_factor"] == 0.0:
            return 0.0
        base = site["base_units"] * site["weekend_factor"]
        return max(0.0, rng.gauss(base, site["std_units"] * 0.3))

    # Anomaly days — partial production (simulates kiln startup after maintenance)
    if day_offset in ANOMALY_DAYS_OFFSET:
        reduced = site["base_units"] * rng.uniform(0.25, 0.45)
        return round(max(0.0, reduced), 0)

    # Normal production day with Gaussian noise
    units = rng.gauss(site["base_units"], site["std_units"])

    # Slight upward trend over 90 days (ramp-up after slow Q1)
    trend_boost = (day_offset / 90) * site["base_units"] * 0.05
    units += trend_boost

    return round(max(0.0, units), 0)


def run(days: int = 90, dry_run: bool = False) -> None:
    rng = random.Random(42)  # fixed seed for reproducibility

    end_date = date.today() - timedelta(days=1)   # yesterday
    start_date = end_date - timedelta(days=days - 1)

    db = SessionLocal()
    inserted = updated = skipped = 0

    try:
        for site in SITES:
            print(f"\n{'─' * 60}")
            print(f"Seeding {site['label']} ({days} days)")
            print(f"{'─' * 60}")

            for offset in range(days):
                d = start_date + timedelta(days=offset)
                units = generate_production(site, d, offset, rng)

                # Skip zero-production days (closed) — no record needed
                if units == 0.0:
                    skipped += 1
                    continue

                existing = (
                    db.query(ProductionRecord)
                    .filter(
                        ProductionRecord.site_id == site["site_id"],
                        ProductionRecord.date == d,
                    )
                    .first()
                )

                if existing:
                    if not dry_run:
                        existing.units_produced = units
                        existing.unit_label = site["unit_label"]
                    print(f"  UPDATE  {d}  →  {units:,.0f} {site['unit_label']}")
                    updated += 1
                else:
                    if not dry_run:
                        db.add(
                            ProductionRecord(
                                organization_id=site["organization_id"],
                                site_id=site["site_id"],
                                date=d,
                                units_produced=units,
                                unit_label=site["unit_label"],
                                notes="seeded" if offset not in ANOMALY_DAYS_OFFSET else "anomaly: maintenance day",
                            )
                        )
                    print(f"  INSERT  {d}  →  {units:,.0f} {site['unit_label']}"
                          + (" ⚠ anomaly" if offset in ANOMALY_DAYS_OFFSET else ""))
                    inserted += 1

        if not dry_run:
            db.commit()
            print(f"\n✅ Committed to DB")
        else:
            print(f"\n🔍 Dry run — no changes written")

        print(f"\nSummary:")
        print(f"  Inserted : {inserted}")
        print(f"  Updated  : {updated}")
        print(f"  Skipped  : {skipped} (zero-production / weekend days)")
        print(f"  Total    : {inserted + updated + skipped}")

    except Exception as exc:
        db.rollback()
        print(f"\n❌ Error: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed production_record table for Ceramica Rossi Srl")
    parser.add_argument("--days", type=int, default=90, help="Number of days to seed (default: 90)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    args = parser.parse_args()

    run(days=args.days, dry_run=args.dry_run)
    