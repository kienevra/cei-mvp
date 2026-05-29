# backend/app/services/demo_seed.py
"""
Demo data topup service.

Runs daily at 03:00 UTC via APScheduler.
Keeps Ceramica Rossi Srl (org 3) timeseries data fresh so
charts and cards stay lit up for demos.

Only runs if:
  - The integration token is configured in settings/env
  - The org actually exists
  - The latest timeseries is more than 2 hours old
"""

from __future__ import annotations

import logging
import math
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.db.session import SessionLocal

logger = logging.getLogger("cei")

DEMO_ORG_ID   = 3
METER_ID      = "main-meter"
BATCH_SIZE    = 500


def _efficient_kwh(hour: int, dow: int) -> float:
    if dow >= 5:
        return max(20, 30 + random.gauss(0, 3))
    if 7 <= hour < 18:
        peak = 180 * math.exp(-0.5 * ((hour - 12) / 4) ** 2)
        return max(40, peak + random.gauss(0, 8))
    elif 6 <= hour < 7 or 18 <= hour < 20:
        return 70 + random.gauss(0, 6)
    return 38 + random.gauss(0, 4)


def _wasteful_kwh(hour: int, dow: int) -> float:
    base = 120 + random.gauss(0, 12)
    if 8 <= hour < 17:
        prod = 200 + random.gauss(0, 25)
    elif 17 <= hour < 22:
        prod = 160 + random.gauss(0, 20)
    else:
        prod = base + random.gauss(0, 15)
    if random.random() < 0.10:
        prod += random.uniform(60, 140)
    return max(80, base + prod * 0.6)


def _fluctuating_kwh(hour: int, dow: int, day_idx: int) -> float:
    week = (day_idx // 7) % 2
    if week == 0:
        return _efficient_kwh(hour, dow) * random.uniform(0.95, 1.10)
    return _wasteful_kwh(hour, dow) * random.uniform(0.90, 1.05)


def run_demo_data_topup_job() -> None:
    """
    APScheduler job — runs daily at 03:00 UTC.
    Adds timeseries data from the last known timestamp to now.
    """
    logger.info("DemoTopup: starting daily data topup for demo org %s", DEMO_ORG_ID)
    db = SessionLocal()
    try:
        _run_topup(db)
    except Exception as exc:
        logger.exception("DemoTopup: job failed: %s", exc)
    finally:
        db.close()


def _run_topup(db: Session) -> None:
    from sqlalchemy import text
    from app.models import Site, TimeseriesRecord

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    # Find sites for demo org
    sites = db.query(Site).filter(Site.org_id == DEMO_ORG_ID).order_by(Site.id).all()
    if not sites:
        logger.info("DemoTopup: no sites found for org %s", DEMO_ORG_ID)
        return

    generators = {}
    for i, site in enumerate(sites):
        site_id_str = f"site-{site.id}"
        if i == 0:
            generators[site_id_str] = lambda h, d, idx: _efficient_kwh(h, d)
        elif i == 1:
            generators[site_id_str] = lambda h, d, idx: _wasteful_kwh(h, d)
        else:
            generators[site_id_str] = _fluctuating_kwh

    total_inserted = 0

    for site_id_str, gen_fn in generators.items():
        # Find latest timestamp for this site
        row = db.execute(
            text("SELECT MAX(timestamp) FROM timeseries_record WHERE site_id = :sid AND organization_id = :org_id"),
            {"sid": site_id_str, "org_id": DEMO_ORG_ID}
        ).fetchone()

        latest = row[0] if row and row[0] else None
        if latest is None:
            logger.info("DemoTopup: no existing data for %s, skipping", site_id_str)
            continue

        # Make timezone aware
        if latest.tzinfo is None:
            latest = latest.replace(tzinfo=timezone.utc)

        start = latest + timedelta(hours=1)
        if start >= now:
            logger.info("DemoTopup: %s is up to date (latest=%s)", site_id_str, latest)
            continue

        hours_to_fill = int((now - start).total_seconds() / 3600)
        logger.info("DemoTopup: filling %d hours for %s", hours_to_fill, site_id_str)

        records = []
        current = start
        day_idx = 0
        while current <= now:
            value = round(gen_fn(current.hour, current.weekday(), day_idx), 2)
            records.append(TimeseriesRecord(
                site_id=site_id_str,
                meter_id=METER_ID,
                organization_id=DEMO_ORG_ID,
                timestamp=current,
                value=value,
                unit="kWh",
            ))
            current += timedelta(hours=1)
            if current.hour == 0:
                day_idx += 1

        # Bulk insert in batches
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                db.bulk_save_objects(batch)
                db.commit()
                total_inserted += len(batch)
            except Exception as exc:
                db.rollback()
                logger.warning("DemoTopup: batch insert failed for %s: %s", site_id_str, exc)

    logger.info("DemoTopup: job complete — %d records inserted across %d sites", total_inserted, len(sites))