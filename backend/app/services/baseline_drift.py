# backend/app/services/baseline_drift.py
"""
Baseline drift detection for CEI.

Answers the question: "Has the energy pattern for this site shifted
persistently, and if so, which hours changed, by how much, and what
does it cost?"

Design:
  - Split 30-day history into reference (days 8–30) and recent (days 1–7)
  - Compare per-bucket (hour_of_day, weekday/weekend) means
  - Drift is flagged when recent mean > reference mean by threshold
    AND the pattern is consistent across at least 3 of the 7 recent days
  - Returns structured drift report including affected hours, drift %, and
    annualised cost impact

ISO 50001 relevance:
  - The reference period is the "baseline" in ISO 50001 language
  - Drift events should trigger a review: is this a new permanent load
    (update the baseline) or is it waste (fix it)?
  - The drift report provides the evidence trail for both decisions

Threshold guide:
  DRIFT_WARNING_PCT  = 15%  — worth investigating
  DRIFT_CRITICAL_PCT = 30%  — significant structural change
  MIN_CONSISTENT_DAYS = 3   — avoids false positives from single-day events
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import TimeseriesRecord

logger = logging.getLogger("cei")

# ── Thresholds ────────────────────────────────────────────────────────────────

DRIFT_WARNING_PCT: float = 15.0   # % above reference mean to flag warning
DRIFT_CRITICAL_PCT: float = 30.0  # % above reference mean to flag critical
MIN_CONSISTENT_DAYS: int = 3      # min days in recent window showing drift
REFERENCE_START_DAY: int = 8      # reference window: days 8–30 before now
REFERENCE_END_DAY: int = 30
RECENT_DAYS: int = 7              # recent window: last 7 days

DEFAULT_EMISSION_FACTOR = 0.4     # kg CO2 per kWh
HOURS_PER_YEAR = 8_760.0


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class BucketDrift:
    """Drift for a single (hour_of_day, is_weekend) bucket."""
    hour_of_day: int
    is_weekend: bool
    reference_mean_kwh: float
    recent_mean_kwh: float
    drift_pct: float          # positive = recent higher than reference
    drift_kwh: float          # absolute difference per hour
    consistent_days: int      # how many of the 7 recent days showed this drift
    severity: str             # "normal", "warning", "critical"


@dataclass
class BaselineDriftReport:
    """Full drift report for a site."""
    site_id: str
    generated_at: str
    reference_window_days: int          # how many days in reference period
    recent_window_days: int             # how many days in recent period
    reference_n_points: int
    recent_n_points: int

    # Overall drift
    overall_drift_pct: float            # weighted average across all buckets
    overall_drift_kwh_per_hour: float   # average excess per hour
    has_warning: bool
    has_critical: bool
    drift_direction: str                # "up", "down", "stable"

    # Affected buckets (only those with |drift_pct| >= DRIFT_WARNING_PCT)
    drifted_buckets: List[BucketDrift] = field(default_factory=list)

    # Cost impact
    est_annual_excess_kwh: float = 0.0
    est_annual_cost_impact: float = 0.0
    est_co2_impact_tons: float = 0.0
    currency_code: str = "EUR"
    electricity_price_per_kwh: Optional[float] = None

    # Narrative summary
    summary: str = ""

    # Confidence
    confidence_level: str = "normal"   # "low" / "normal"
    is_warming_up: bool = False


# ── Internal helpers ──────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.utcnow()


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _load_window(
    db: Session,
    site_id: str,
    start: datetime,
    end: datetime,
    organization_id: Optional[int],
    allowed_site_ids: Optional[List[str]],
) -> List[TimeseriesRecord]:
    q = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id == site_id)
        .filter(TimeseriesRecord.timestamp >= start)
        .filter(TimeseriesRecord.timestamp < end)
    )
    if organization_id is not None:
        q = q.filter(TimeseriesRecord.organization_id == organization_id)
    if allowed_site_ids:
        q = q.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))
    return q.all()


def _bucket_key(ts: datetime) -> Tuple[int, bool]:
    """Return (hour_of_day, is_weekend) for a timestamp."""
    return ts.hour, ts.weekday() >= 5


def _build_bucket_means(
    rows: List[TimeseriesRecord],
) -> Dict[Tuple[int, bool], float]:
    """Compute mean kWh per (hour_of_day, is_weekend) bucket."""
    groups: Dict[Tuple[int, bool], List[float]] = defaultdict(list)
    for row in rows:
        if row.timestamp is None:
            continue
        try:
            val = float(row.value)
        except Exception:
            continue
        key = _bucket_key(_as_utc(row.timestamp))
        groups[key].append(val)

    return {k: mean(v) for k, v in groups.items() if v}


def _build_daily_bucket_means(
    rows: List[TimeseriesRecord],
) -> Dict[Tuple[int, bool], Dict[int, float]]:
    """
    Compute per-day per-bucket means.
    Returns {(hour_of_day, is_weekend): {day_offset: mean_kwh}}
    Used to count how many days show drift.
    """
    # Group by (bucket_key, date)
    groups: Dict[Tuple[Tuple[int, bool], Any], List[float]] = defaultdict(list)
    for row in rows:
        if row.timestamp is None:
            continue
        try:
            val = float(row.value)
        except Exception:
            continue
        ts = _as_utc(row.timestamp)
        bk = _bucket_key(ts)
        date_key = ts.date()
        groups[(bk, date_key)].append(val)

    # Aggregate to per-bucket per-day means
    result: Dict[Tuple[int, bool], Dict[Any, float]] = defaultdict(dict)
    for (bk, date_key), vals in groups.items():
        result[bk][date_key] = mean(vals)

    return dict(result)


# ── Public API ────────────────────────────────────────────────────────────────

def compute_baseline_drift(
    db: Session,
    *,
    site_id: str,
    now: Optional[datetime] = None,
    organization_id: Optional[int] = None,
    allowed_site_ids: Optional[List[str]] = None,
    electricity_price_per_kwh: Optional[float] = None,
    currency_code: str = "EUR",
    emission_factor: float = DEFAULT_EMISSION_FACTOR,
) -> Optional[BaselineDriftReport]:
    """
    Compute baseline drift for a site.

    Compares the last 7 days against the prior 8–30 day reference period.
    Returns a BaselineDriftReport or None if insufficient data.
    """
    if now is None:
        now = _utcnow()

    now_utc = _as_utc(now)
    recent_start = now_utc - timedelta(days=RECENT_DAYS)
    reference_start = now_utc - timedelta(days=REFERENCE_END_DAY)
    reference_end = now_utc - timedelta(days=REFERENCE_START_DAY)

    # Load both windows
    reference_rows = _load_window(
        db, site_id, reference_start, reference_end,
        organization_id, allowed_site_ids,
    )
    recent_rows = _load_window(
        db, site_id, recent_start, now_utc,
        organization_id, allowed_site_ids,
    )

    if len(reference_rows) < 24:
        logger.info(
            "Drift: insufficient reference data for site %s (%d rows)",
            site_id, len(reference_rows),
        )
        return BaselineDriftReport(
            site_id=site_id,
            generated_at=now_utc.isoformat(),
            reference_window_days=REFERENCE_END_DAY - REFERENCE_START_DAY,
            recent_window_days=RECENT_DAYS,
            reference_n_points=len(reference_rows),
            recent_n_points=len(recent_rows),
            overall_drift_pct=0.0,
            overall_drift_kwh_per_hour=0.0,
            has_warning=False,
            has_critical=False,
            drift_direction="stable",
            confidence_level="low",
            is_warming_up=True,
            summary="Insufficient reference data — need at least 8 days of history for drift detection.",
        )

    if len(recent_rows) < 12:
        logger.info(
            "Drift: insufficient recent data for site %s (%d rows)",
            site_id, len(recent_rows),
        )
        return None

    # Compute bucket means for both windows
    reference_means = _build_bucket_means(reference_rows)
    recent_means = _build_bucket_means(recent_rows)
    recent_daily = _build_daily_bucket_means(recent_rows)

    if not reference_means:
        return None

    # ── Compute per-bucket drift ──────────────────────────────────────────────
    drifted_buckets: List[BucketDrift] = []
    all_drifts: List[float] = []
    all_drift_kwh: List[float] = []

    for bucket_key, ref_mean in reference_means.items():
        if ref_mean <= 0:
            continue
        rec_mean = recent_means.get(bucket_key)
        if rec_mean is None:
            continue

        drift_pct = (rec_mean - ref_mean) / ref_mean * 100.0
        drift_kwh = rec_mean - ref_mean
        all_drifts.append(drift_pct)
        all_drift_kwh.append(drift_kwh)

        if abs(drift_pct) < DRIFT_WARNING_PCT:
            continue

        # Count consistent days in recent window
        daily_vals = recent_daily.get(bucket_key, {})
        consistent_days = sum(
            1 for day_mean in daily_vals.values()
            if ref_mean > 0 and ((day_mean - ref_mean) / ref_mean * 100.0) >= DRIFT_WARNING_PCT
        )

        if consistent_days < MIN_CONSISTENT_DAYS:
            continue  # Not persistent enough

        hour_of_day, is_weekend = bucket_key
        if drift_pct >= DRIFT_CRITICAL_PCT:
            severity = "critical"
        elif drift_pct >= DRIFT_WARNING_PCT:
            severity = "warning"
        elif drift_pct <= -DRIFT_WARNING_PCT:
            severity = "info"  # Consumption dropped — could be good
        else:
            severity = "normal"

        drifted_buckets.append(BucketDrift(
            hour_of_day=hour_of_day,
            is_weekend=is_weekend,
            reference_mean_kwh=round(ref_mean, 2),
            recent_mean_kwh=round(rec_mean, 2),
            drift_pct=round(drift_pct, 2),
            drift_kwh=round(drift_kwh, 2),
            consistent_days=consistent_days,
            severity=severity,
        ))

    # Sort by absolute drift descending
    drifted_buckets.sort(key=lambda b: abs(b.drift_pct), reverse=True)

    # ── Overall drift metrics ─────────────────────────────────────────────────
    overall_drift_pct = mean(all_drifts) if all_drifts else 0.0
    overall_drift_kwh = mean(all_drift_kwh) if all_drift_kwh else 0.0

    has_warning = any(b.severity in ("warning", "critical") for b in drifted_buckets)
    has_critical = any(b.severity == "critical" for b in drifted_buckets)

    if overall_drift_pct > 2.0:
        drift_direction = "up"
    elif overall_drift_pct < -2.0:
        drift_direction = "down"
    else:
        drift_direction = "stable"

    # ── Cost impact ───────────────────────────────────────────────────────────
    # Annualise excess kWh from drifted buckets only
    total_excess_kwh_per_hour = sum(
        b.drift_kwh for b in drifted_buckets if b.drift_kwh > 0
    )
    est_annual_excess_kwh = total_excess_kwh_per_hour * HOURS_PER_YEAR

    price = electricity_price_per_kwh if electricity_price_per_kwh and electricity_price_per_kwh > 0 else 0.23
    est_annual_cost = round(est_annual_excess_kwh * price, 0)
    est_co2 = round((est_annual_excess_kwh * emission_factor) / 1000.0, 2)

    # ── Narrative summary ─────────────────────────────────────────────────────
    summary = _build_summary(
        site_id=site_id,
        drifted_buckets=drifted_buckets,
        overall_drift_pct=overall_drift_pct,
        drift_direction=drift_direction,
        est_annual_cost=est_annual_cost,
        currency_code=currency_code,
        price=price,
    )

    logger.info(
        "Drift: site %s overall_drift=%.1f%% drifted_buckets=%d has_critical=%s",
        site_id, overall_drift_pct, len(drifted_buckets), has_critical,
    )

    return BaselineDriftReport(
        site_id=site_id,
        generated_at=now_utc.isoformat(),
        reference_window_days=REFERENCE_END_DAY - REFERENCE_START_DAY,
        recent_window_days=RECENT_DAYS,
        reference_n_points=len(reference_rows),
        recent_n_points=len(recent_rows),
        overall_drift_pct=round(overall_drift_pct, 2),
        overall_drift_kwh_per_hour=round(overall_drift_kwh, 2),
        has_warning=has_warning,
        has_critical=has_critical,
        drift_direction=drift_direction,
        drifted_buckets=drifted_buckets,
        est_annual_excess_kwh=round(est_annual_excess_kwh, 0),
        est_annual_cost_impact=est_annual_cost,
        est_co2_impact_tons=est_co2,
        currency_code=currency_code,
        electricity_price_per_kwh=electricity_price_per_kwh,
        summary=summary,
        confidence_level="normal",
        is_warming_up=False,
    )


def _build_summary(
    site_id: str,
    drifted_buckets: List[BucketDrift],
    overall_drift_pct: float,
    drift_direction: str,
    est_annual_cost: float,
    currency_code: str,
    price: float,
) -> str:
    if not drifted_buckets:
        if drift_direction == "stable":
            return (
                "Energy pattern is stable. No persistent drift detected between the "
                "recent 7-day period and the prior reference baseline."
            )
        elif drift_direction == "down":
            return (
                f"Energy consumption has decreased by {abs(overall_drift_pct):.1f}% "
                "vs the reference baseline — no action required. "
                "Consider updating your baseline to reflect the improved efficiency."
            )
        return "Minor drift detected but below the threshold for action."

    # Find the most significant drifted bucket
    worst = drifted_buckets[0]
    hour_label = f"{worst.hour_of_day:02d}:00"
    day_type = "weekend" if worst.is_weekend else "weekday"

    critical_count = sum(1 for b in drifted_buckets if b.severity == "critical")
    warning_count = sum(1 for b in drifted_buckets if b.severity == "warning")

    parts = []

    if critical_count > 0:
        parts.append(
            f"Critical baseline drift detected: {critical_count} hour bucket(s) "
            f"are running {worst.drift_pct:.0f}% above the reference baseline "
            f"(most affected: {day_type} {hour_label}, "
            f"{worst.reference_mean_kwh:.0f} → {worst.recent_mean_kwh:.0f} kWh/h, "
            f"persistent across {worst.consistent_days} of the last 7 days)."
        )
    elif warning_count > 0:
        parts.append(
            f"Baseline drift warning: {warning_count} hour bucket(s) showing "
            f"persistent elevation above reference. Most affected: "
            f"{day_type} {hour_label} at +{worst.drift_pct:.0f}% "
            f"({worst.consistent_days} of 7 days)."
        )

    if est_annual_cost > 0:
        parts.append(
            f"If this drift persists, estimated annual cost impact: "
            f"{currency_code}{est_annual_cost:,.0f} at {currency_code}{price}/kWh."
        )

    parts.append(
        "Action: determine whether this represents a new permanent load "
        "(update your baseline to reflect normal operations) or waste "
        "(identify and fix the source). Use the Opportunities tab for specific recommendations."
    )

    return " ".join(parts)