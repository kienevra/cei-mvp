# backend/app/services/forecast_cache.py
"""
Prophet forecast background cache.

Instead of running Prophet synchronously on every HTTP request (30s+),
this module:
  1. Serves cached forecasts instantly from the forecast_cache DB table.
  2. Provides a background job that pre-computes forecasts for all active sites.

The cache TTL is 1 hour. If no cache exists yet the forecast endpoint falls
back to computing Prophet inline (first-load behaviour).

Scheduler job: run_forecast_cache_job()
  - Called by APScheduler every hour at :05 past the hour
  - Iterates all sites that have timeseries data in the last 48h
  - Fits Prophet and writes results to forecast_cache
  - Skips sites with insufficient data (< 48 hourly points)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import Site, Organization, TimeseriesRecord

logger = logging.getLogger("cei")

CACHE_TTL_HOURS = 1
HORIZON_HOURS   = 48
LOOKBACK_DAYS   = 30


# ── Read from cache ───────────────────────────────────────────────────────────

def get_cached_forecast(
    db: Session,
    site_id: str,
    organization_id: int,
    horizon_hours: int = HORIZON_HOURS,
    lookback_days: int = LOOKBACK_DAYS,
) -> Optional[Dict[str, Any]]:
    """
    Return a cached forecast if it exists and has not expired.
    Returns None if no valid cache entry exists.
    """
    now = datetime.now(timezone.utc)
    try:
        row = db.execute(
            text("""
                SELECT payload, generated_at, expires_at
                FROM forecast_cache
                WHERE site_id        = :site_id
                  AND organization_id = :org_id
                  AND horizon_hours  = :horizon_hours
                  AND lookback_days  = :lookback_days
                  AND expires_at     > :now
                LIMIT 1
            """),
            {
                "site_id":       site_id,
                "org_id":        organization_id,
                "horizon_hours": horizon_hours,
                "lookback_days": lookback_days,
                "now":           now,
            }
        ).fetchone()

        if row is None:
            return None

        payload = row[0]
        if isinstance(payload, str):
            payload = json.loads(payload)

        logger.info("Forecast cache HIT for site=%s org=%s", site_id, organization_id)
        return payload

    except Exception as exc:
        logger.warning("Forecast cache read failed for site=%s: %s", site_id, exc)
        return None


# ── Write to cache ────────────────────────────────────────────────────────────

def set_cached_forecast(
    db: Session,
    site_id: str,
    organization_id: int,
    horizon_hours: int,
    lookback_days: int,
    payload: Dict[str, Any],
) -> None:
    """
    Upsert a forecast result into the cache table.
    Uses INSERT ... ON CONFLICT DO UPDATE (upsert).
    """
    now     = datetime.now(timezone.utc)
    expires = now + timedelta(hours=CACHE_TTL_HOURS)

    try:
        db.execute(
            text("""
                INSERT INTO forecast_cache
                    (site_id, organization_id, horizon_hours, lookback_days,
                     method, payload, generated_at, expires_at)
                VALUES
                    (:site_id, :org_id, :horizon_hours, :lookback_days,
                     :method, :payload::jsonb, :generated_at, :expires_at)
                ON CONFLICT (site_id, organization_id, horizon_hours, lookback_days)
                DO UPDATE SET
                    method       = EXCLUDED.method,
                    payload      = EXCLUDED.payload,
                    generated_at = EXCLUDED.generated_at,
                    expires_at   = EXCLUDED.expires_at
            """),
            {
                "site_id":       site_id,
                "org_id":        organization_id,
                "horizon_hours": horizon_hours,
                "lookback_days": lookback_days,
                "method":        payload.get("method", "prophet_v1"),
                "payload":       json.dumps(payload),
                "generated_at":  now,
                "expires_at":    expires,
            }
        )
        db.commit()
        logger.info(
            "Forecast cache WRITE site=%s org=%s horizon=%sh expires=%s",
            site_id, organization_id, horizon_hours, expires.isoformat()
        )
    except Exception as exc:
        db.rollback()
        logger.warning("Forecast cache write failed for site=%s: %s", site_id, exc)


# ── Background job ────────────────────────────────────────────────────────────

def run_forecast_cache_job() -> None:
    """
    APScheduler job — runs every hour at :05 past the hour.

    For every site that has timeseries data in the last 48 hours:
      1. Fits Prophet on 30 days of history
      2. Writes the 48-hour forecast to forecast_cache

    Skips sites with < 48 hourly data points (insufficient for Prophet).
    """
    logger.info("ForecastCache: background job starting")
    db = SessionLocal()
    try:
        _run_cache_job(db)
    except Exception as exc:
        logger.exception("ForecastCache: job failed: %s", exc)
    finally:
        db.close()
    logger.info("ForecastCache: background job complete")


def _run_cache_job(db: Session) -> None:
    from app.services.forecast import compute_site_forecast_prophet
    from app.api.deps import get_org_allowed_site_ids

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=48)

    # Find all (site_id, organization_id) pairs with recent data
    rows = db.execute(
        text("""
            SELECT DISTINCT site_id, organization_id
            FROM timeseries_record
            WHERE timestamp >= :cutoff
              AND organization_id IS NOT NULL
        """),
        {"cutoff": cutoff}
    ).fetchall()

    logger.info("ForecastCache: %d active site/org pairs to refresh", len(rows))

    success = 0
    skipped = 0
    failed  = 0

    for site_id, org_id in rows:
        try:
            # Check if cache is still fresh — skip if expires > 30 min from now
            existing = db.execute(
                text("""
                    SELECT expires_at FROM forecast_cache
                    WHERE site_id = :site_id
                      AND organization_id = :org_id
                      AND horizon_hours = :horizon_hours
                      AND lookback_days = :lookback_days
                """),
                {
                    "site_id":       site_id,
                    "org_id":        org_id,
                    "horizon_hours": HORIZON_HOURS,
                    "lookback_days": LOOKBACK_DAYS,
                }
            ).fetchone()

            if existing and existing[0] and existing[0] > now + timedelta(minutes=30):
                skipped += 1
                continue

            # Compute forecast
            result = compute_site_forecast_prophet(
                db=db,
                site_id=site_id,
                horizon_hours=HORIZON_HOURS,
                lookback_days=LOOKBACK_DAYS,
                organization_id=org_id,
            )

            if result and result.get("points"):
                set_cached_forecast(
                    db=db,
                    site_id=site_id,
                    organization_id=org_id,
                    horizon_hours=HORIZON_HOURS,
                    lookback_days=LOOKBACK_DAYS,
                    payload=result,
                )
                success += 1
            else:
                skipped += 1

        except Exception as exc:
            logger.warning(
                "ForecastCache: failed for site=%s org=%s: %s",
                site_id, org_id, exc
            )
            failed += 1
            # Keep going — don't let one site failure stop the job
            continue

    logger.info(
        "ForecastCache: job done — success=%d skipped=%d failed=%d",
        success, skipped, failed
    )