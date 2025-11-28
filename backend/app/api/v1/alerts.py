# backend/app/api/v1/alerts.py
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Literal, Any, Set

from fastapi import APIRouter, Depends, Query, status, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import TimeseriesRecord  # Site/Organization imported lazily where needed
from app.services.analytics import compute_site_insights  # <-- statistical engine

logger = logging.getLogger("cei")

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertOut(BaseModel):
    id: str
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    severity: Literal["critical", "warning", "info"]
    title: str
    message: str
    metric: Optional[str] = None
    window_hours: int
    triggered_at: datetime

    # --- Optional statistical context (from compute_site_insights / baseline_profile) ---
    deviation_pct: Optional[float] = None
    total_actual_kwh: Optional[float] = None
    total_expected_kwh: Optional[float] = None
    baseline_lookback_days: Optional[int] = None

    global_mean_kwh: Optional[float] = None
    global_p50_kwh: Optional[float] = None
    global_p90_kwh: Optional[float] = None

    critical_hours: Optional[int] = None
    elevated_hours: Optional[int] = None
    below_baseline_hours: Optional[int] = None

    stats_source: Optional[str] = None  # e.g. "baseline_v1"

    class Config:
        from_attributes = True  # pydantic v2 replacement for orm_mode


class AlertThresholdsConfig(BaseModel):
    """
    Central place to tune alert thresholds.

    Global defaults live here; you can override per-site below.
    """

    # Night vs day baseline
    night_warning_ratio: float = 0.4   # >= 40% of day -> warning
    night_critical_ratio: float = 0.7  # >= 70% of day -> critical

    # Peak vs average (short windows)
    spike_warning_ratio: float = 2.5   # >= 2.5x avg -> warning

    # Portfolio dominance
    portfolio_share_info_ratio: float = 1.5  # >= 1.5x avg per site -> info

    # Weekend vs weekday baseline
    weekend_warning_ratio: float = 0.6   # weekend >= 60% of weekday -> warning
    weekend_critical_ratio: float = 0.8  # weekend >= 80% of weekday -> critical

    # Data quality guards
    min_points: int = 4
    min_total_kwh: float = 0.0


# Global defaults
DEFAULT_THRESHOLDS = AlertThresholdsConfig()

# Optional per-site overrides (keyed by timeseries site_id, e.g. "site-1")
SITE_THRESHOLDS: Dict[str, AlertThresholdsConfig] = {
    # Example override:
    # "site-1": AlertThresholdsConfig(
    #     night_warning_ratio=0.5,
    #     night_critical_ratio=0.8,
    #     spike_warning_ratio=3.0,
    # )
}


def get_thresholds_for_site(site_id: Optional[str]) -> AlertThresholdsConfig:
    if not site_id:
        return DEFAULT_THRESHOLDS
    return SITE_THRESHOLDS.get(site_id, DEFAULT_THRESHOLDS)


def _user_has_alerts_enabled(db: Session, user: Any) -> bool:
    """
    Plan-level guard for alerts.

    Logic:
    - If we can't resolve an org at all -> default to True (single-tenant/dev).
    - If org.enable_alerts exists -> trust it.
    - Else, derive from plan_key/subscription_plan_key:
        - "cei-starter" or "cei-growth" -> True
        - anything else -> False
    - On any exception, default to True so we don't brick the app.
    """
    try:
        org = None

        # Relationship style: user.organization
        if hasattr(user, "organization") and getattr(user, "organization") is not None:
            org = getattr(user, "organization")
        else:
            # Fallback: look up by organization_id if possible
            org_id = getattr(user, "organization_id", None)
            if org_id:
                try:
                    from app.models import Organization  # type: ignore
                except Exception:
                    org = None
                else:
                    org = (
                        db.query(Organization)
                        .filter(Organization.id == org_id)
                        .first()
                    )

        if not org:
            # No org concept -> treat as dev/single-tenant -> alerts allowed
            return True

        explicit_flag = getattr(org, "enable_alerts", None)
        if explicit_flag is not None:
            return bool(explicit_flag)

        plan_key = (
            getattr(org, "subscription_plan_key", None)
            or getattr(org, "plan_key", None)
        )

        if not plan_key:
            # No plan info -> default to enabled to avoid surprise lockouts
            return True

        # Starter / Growth tiers get alerts; others (e.g. free) do not
        return plan_key in ("cei-starter", "cei-growth")

    except Exception:
        logger.exception(
            "Failed to resolve alerts plan flag; defaulting to enabled."
        )
        return True


@router.get(
    "/",
    response_model=List[AlertOut],
    status_code=status.HTTP_200_OK,
)
def list_alerts(
    window_hours: int = Query(
        24,
        ge=1,
        le=24 * 30,
        description="Look-back window in hours (e.g. 24, 168 for 7 days).",
    ),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[AlertOut]:
    """
    Return portfolio alerts computed from TimeseriesRecord.

    Rules (MVP, but grounded in real ops):
    - High night-time baseline (critical / warning)
    - Peak spikes vs average (warning)
    - Site dominating portfolio energy (info)
    - Weekend baseline too close to weekday baseline (warning / critical)

    Now additionally enriched with:
    - baseline deviation_pct
    - global_mean/p50/p90 kWh
    - critical/elevated/below-baseline hours
    """

    # --- Plan / feature gating ---
    if not _user_has_alerts_enabled(db, user):
        logger.info(
            "Alerts disabled by plan for user=%s org_id=%s",
            getattr(user, "email", None),
            getattr(user, "organization_id", None),
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alerts are not enabled for this organization/plan.",
        )

    # --- Org-scoped site IDs (multi-tenant safety) ---
    allowed_site_ids: Optional[Set[str]] = None
    try:
        org = getattr(user, "organization", None)
        if org is not None and hasattr(org, "sites"):
            allowed_site_ids = {
                f"site-{s.id}"
                for s in getattr(org, "sites", [])
                if getattr(s, "id", None) is not None
            }
            # Also allow raw numeric IDs if your ingestion ever uses them
            allowed_site_ids.update(
                {str(s.id) for s in getattr(org, "sites", []) if getattr(s, "id", None) is not None}
            )
    except Exception:
        logger.exception("Failed to compute allowed_site_ids; falling back to unrestricted.")
        allowed_site_ids = None

    # Clamp any silly values
    if window_hours <= 0:
        window_hours = 24
    if window_hours > 24 * 30:
        window_hours = 24 * 30

    alerts = _generate_alerts_for_window(
        db=db,
        window_hours=window_hours,
        allowed_site_ids=allowed_site_ids,
    )
    logger.info("Generated %d alerts for window_hours=%s", len(alerts), window_hours)
    return alerts


# ---- Internal helpers ----


def _build_stats_context_from_insights(
    insights: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Normalize compute_site_insights output into a flat set of optional fields
    that can be attached to any AlertOut.
    """
    if not insights:
        return {}

    deviation_pct = insights.get("deviation_pct")
    total_actual_kwh = insights.get("total_actual_kwh")
    total_expected_kwh = insights.get("total_expected_kwh")
    baseline_lookback_days = insights.get("baseline_lookback_days")

    critical_hours = insights.get("critical_hours")
    elevated_hours = insights.get("elevated_hours")
    below_baseline_hours = insights.get("below_baseline_hours")

    baseline_profile = insights.get("baseline_profile") or {}
    global_mean_kwh = baseline_profile.get("global_mean_kwh")
    global_p50_kwh = baseline_profile.get("global_p50_kwh")
    global_p90_kwh = baseline_profile.get("global_p90_kwh")

    ctx: Dict[str, Any] = {
        "deviation_pct": float(deviation_pct) if deviation_pct is not None else None,
        "total_actual_kwh": float(total_actual_kwh) if total_actual_kwh is not None else None,
        "total_expected_kwh": float(total_expected_kwh) if total_expected_kwh is not None else None,
        "baseline_lookback_days": int(baseline_lookback_days) if baseline_lookback_days is not None else None,
        "global_mean_kwh": float(global_mean_kwh) if global_mean_kwh is not None else None,
        "global_p50_kwh": float(global_p50_kwh) if global_p50_kwh is not None else None,
        "global_p90_kwh": float(global_p90_kwh) if global_p90_kwh is not None else None,
        "critical_hours": int(critical_hours) if critical_hours is not None else None,
        "elevated_hours": int(elevated_hours) if elevated_hours is not None else None,
        "below_baseline_hours": int(below_baseline_hours) if below_baseline_hours is not None else None,
        "stats_source": "baseline_v1",
    }

    # Filter out pure Nones so the JSON stays lean
    return {k: v for k, v in ctx.items() if v is not None}


def _generate_alerts_for_window(
    db: Session,
    window_hours: int,
    allowed_site_ids: Optional[Set[str]] = None,
) -> List[AlertOut]:
    now = datetime.utcnow()
    window_start = now - timedelta(hours=window_hours)

    # Base stats per site_id
    stats_query = (
        db.query(
            TimeseriesRecord.site_id,
            func.count().label("points"),
            func.sum(TimeseriesRecord.value).label("total_value"),
            func.avg(TimeseriesRecord.value).label("avg_value"),
            func.max(TimeseriesRecord.value).label("max_value"),
            func.min(TimeseriesRecord.value).label("min_value"),
            func.max(TimeseriesRecord.timestamp).label("last_ts"),
        )
        .filter(TimeseriesRecord.timestamp >= window_start)
    )

    if allowed_site_ids:
        stats_query = stats_query.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    stats_rows = stats_query.group_by(TimeseriesRecord.site_id).all()

    if not stats_rows:
        return []

    # --- Precompute statistical insights per site (baseline engine) ---
    insights_by_site: Dict[str, Dict[str, Any]] = {}
    for row in stats_rows:
        site_id = row.site_id or "unknown"
        try:
            insights = compute_site_insights(
                db=db,
                site_id=site_id,
                window_hours=window_hours,
                # rely on default lookback_days=30 for now
                as_of=now,
            )
        except Exception:
            logger.exception("Failed to compute insights for site_id=%s", site_id)
            insights = None

        if insights:
            insights_by_site[site_id] = insights

    # Aggregate portfolio numbers
    portfolio_total = float(sum((row.total_value or 0) for row in stats_rows))
    total_sites = len(stats_rows)
    portfolio_avg_per_site = portfolio_total / total_sites if total_sites > 0 else 0.0

    # Pull raw points once and compute day/night + weekday/weekend in Python
    points_query = (
        db.query(
            TimeseriesRecord.site_id,
            TimeseriesRecord.timestamp,
            TimeseriesRecord.value,
        )
        .filter(TimeseriesRecord.timestamp >= window_start)
    )

    if allowed_site_ids:
        points_query = points_query.filter(TimeseriesRecord.site_id.in_(allowed_site_ids))

    point_rows = points_query.all()

    # Typical "plant" definition of night and day hours
    night_hours = {0, 1, 2, 3, 4, 5, 22, 23}
    day_hours = {8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19}

    buckets_by_site: Dict[str, Dict[str, float]] = {}

    for row in point_rows:
        site_id = row.site_id or "unknown"
        ts: datetime = row.timestamp
        try:
            val = float(row.value or 0)
        except Exception:
            val = 0.0

        bucket = buckets_by_site.get(site_id)
        if bucket is None:
            bucket = {
                "night_sum": 0.0,
                "night_count": 0.0,
                "day_sum": 0.0,
                "day_count": 0.0,
                "weekday_sum": 0.0,
                "weekday_count": 0.0,
                "weekend_sum": 0.0,
                "weekend_count": 0.0,
            }
            buckets_by_site[site_id] = bucket

        hour = ts.hour
        if hour in night_hours:
            bucket["night_sum"] += val
            bucket["night_count"] += 1
        if hour in day_hours:
            bucket["day_sum"] += val
            bucket["day_count"] += 1

        # Python weekday(): 0=Mon, ..., 6=Sun
        dow = ts.weekday()
        if dow < 5:
            bucket["weekday_sum"] += val
            bucket["weekday_count"] += 1
        else:
            bucket["weekend_sum"] += val
            bucket["weekend_count"] += 1

    # Best-effort site name resolution (e.g. site-1 → Site 1)
    site_name_map: Dict[str, str] = _build_site_name_map(db, stats_rows)

    alerts: List[AlertOut] = []
    alert_id_counter = 1

    for row in stats_rows:
        site_id = row.site_id or "unknown"
        total_value = float(row.total_value or 0)
        points = int(row.points or 0)
        avg_value = float(row.avg_value or 0)
        max_value = float(row.max_value or 0)
        min_value = float(row.min_value or 0)  # reserved for future rules
        last_ts = row.last_ts or now
        site_name = site_name_map.get(site_id)

        thresholds = get_thresholds_for_site(site_id)

        # Skip sites with too little data
        if points < thresholds.min_points or total_value <= thresholds.min_total_kwh:
            continue

        # Pull bucketed stats if we have them
        bucket = buckets_by_site.get(site_id, {})
        night_sum = float(bucket.get("night_sum", 0.0))
        night_count = float(bucket.get("night_count", 0.0))
        day_sum = float(bucket.get("day_sum", 0.0))
        day_count = float(bucket.get("day_count", 0.0))
        weekday_sum = float(bucket.get("weekday_sum", 0.0))
        weekday_count = float(bucket.get("weekday_count", 0.0))
        weekend_sum = float(bucket.get("weekend_sum", 0.0))
        weekend_count = float(bucket.get("weekend_count", 0.0))

        avg_night = night_sum / night_count if night_count > 0 else 0.0
        avg_day = day_sum / day_count if day_count > 0 else 0.0
        avg_weekday = weekday_sum / weekday_count if weekday_count > 0 else 0.0
        avg_weekend = weekend_sum / weekend_count if weekend_count > 0 else 0.0

        # Flattened statistical context for this site (if any)
        insights = insights_by_site.get(site_id)
        stats_ctx = _build_stats_context_from_insights(insights)

        # ---------- Rule 1: Night-time baseline too high ----------

        if avg_day > 0:
            night_ratio = avg_night / avg_day if avg_day > 0 else 0.0
        else:
            night_ratio = 0.0

        # Only consider sites that matter at portfolio level
        is_material = portfolio_total > 0 and total_value >= 0.2 * portfolio_total

        if avg_day > 0 and night_ratio >= thresholds.night_critical_ratio and is_material:
            alerts.append(
                AlertOut(
                    id=f"{alert_id_counter}",
                    site_id=site_id,
                    site_name=site_name,
                    severity="critical",
                    title="High night-time baseline",
                    message=(
                        f"{site_name or site_id} has a night-time baseline at "
                        f"{night_ratio:.0%} of the day-time average over the last {window_hours}h. "
                        "This usually indicates significant idle losses (compressors, HVAC, lines left on)."
                    ),
                    metric="night_baseline_ratio",
                    window_hours=window_hours,
                    triggered_at=last_ts,
                    **stats_ctx,
                )
            )
            alert_id_counter += 1
        elif avg_day > 0 and thresholds.night_warning_ratio <= night_ratio < thresholds.night_critical_ratio:
            alerts.append(
                AlertOut(
                    id=f"{alert_id_counter}",
                    site_id=site_id,
                    site_name=site_name,
                    severity="warning",
                    title="Elevated night-time baseline",
                    message=(
                        f"{site_name or site_id} shows a night-time baseline at "
                        f"{night_ratio:.0%} of day-time average over the last {window_hours}h. "
                        "There is likely low-hanging fruit in shutdown procedures."
                    ),
                    metric="night_baseline_ratio",
                    window_hours=window_hours,
                    triggered_at=last_ts,
                    **stats_ctx,
                )
            )
            alert_id_counter += 1

        # ---------- Rule 2: Peak spikes vs typical load (short windows only) ----------
        if window_hours <= 48 and avg_value > 0:
            spike_ratio = max_value / avg_value if avg_value > 0 else 0.0

            if spike_ratio >= thresholds.spike_warning_ratio and max_value > 0:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="warning",
                        title="Short-term peak significantly above typical load",
                        message=(
                            f"{site_name or site_id} has a peak hour at {max_value:.1f} kWh, "
                            f"which is {spike_ratio:.1f}x the average for the last {window_hours}h. "
                            "Check for overlapping batches, start-up procedures, or one-off events."
                        ),
                        metric="peak_spike_ratio",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                        **stats_ctx,
                    )
                )
                alert_id_counter += 1

        # ---------- Rule 3: Weekend baseline vs weekday baseline ----------
        if avg_weekday > 0 and avg_weekend > 0:
            weekend_ratio = avg_weekend / avg_weekday

            if weekend_ratio >= thresholds.weekend_critical_ratio and is_material:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="critical",
                        title="Weekend baseline close to weekday levels",
                        message=(
                            f"{site_name or site_id} shows weekend consumption at "
                            f"{weekend_ratio:.0%} of weekday average over the last {window_hours}h. "
                            "This usually indicates large portions of the plant stay energized through weekends."
                        ),
                        metric="weekend_weekday_ratio",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                        **stats_ctx,
                    )
                )
                alert_id_counter += 1
            elif weekend_ratio >= thresholds.weekend_warning_ratio:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="warning",
                        title="Elevated weekend baseline",
                        message=(
                            f"{site_name or site_id} has weekend consumption at "
                            f"{weekend_ratio:.0%} of weekday average over the last {window_hours}h. "
                            "Review weekend shutdown procedures and auxiliary loads."
                        ),
                        metric="weekend_weekday_ratio",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                        **stats_ctx,
                    )
                )
                alert_id_counter += 1

        # ---------- Rule 4: Site dominating portfolio energy (informational) ----------
        if portfolio_avg_per_site > 0:
            if total_value >= thresholds.portfolio_share_info_ratio * portfolio_avg_per_site:
                share = (total_value / portfolio_total) * 100 if portfolio_total > 0 else 0
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=site_id,
                        site_name=site_name,
                        severity="info",
                        title="Site dominates portfolio energy",
                        message=(
                            f"{site_name or site_id} is consuming {share:.1f}% of portfolio "
                            f"energy over the last {window_hours}h. This is a natural candidate "
                            "for deeper opportunity hunting and focused projects."
                        ),
                        metric="relative_share",
                        window_hours=window_hours,
                        triggered_at=last_ts,
                        **stats_ctx,
                    )
                )
                alert_id_counter += 1

        # ---------- Rule 5: Forecasted night-time baseline (next 24h) ----------
        # Use the baseline_profile buckets from compute_site_insights as a simple forecast
        # for the next 24 hours, then compare forecasted night vs day averages.
        try:
            baseline_profile = (insights or {}).get("baseline_profile") if insights else None
        except Exception:
            baseline_profile = None

        if baseline_profile and isinstance(baseline_profile, dict):
            buckets = baseline_profile.get("buckets") or []
            # key format: "hour|is_weekend"
            bucket_map: Dict[str, float] = {}

            for b in buckets:
                try:
                    h = int(b.get("hour_of_day"))
                    is_we = bool(b.get("is_weekend"))
                    mean = float(b.get("mean_kwh") or 0.0)
                except Exception:
                    continue
                key = f"{h}|{1 if is_we else 0}"
                bucket_map[key] = mean

            if bucket_map:
                future_night_sum = 0.0
                future_night_count = 0.0
                future_day_sum = 0.0
                future_day_count = 0.0

                # Look ahead 24 hours from "now"
                for offset in range(24):
                    ts_future = now + timedelta(hours=offset + 1)
                    h = ts_future.hour
                    is_we = ts_future.weekday() >= 5
                    key = f"{h}|{1 if is_we else 0}"
                    mean = bucket_map.get(key, 0.0)

                    if h in night_hours:
                        future_night_sum += mean
                        future_night_count += 1
                    if h in day_hours:
                        future_day_sum += mean
                        future_day_count += 1

                if future_day_count > 0 and future_night_count > 0:
                    forecast_night_avg = future_night_sum / future_night_count
                    forecast_day_avg = future_day_sum / future_day_count

                    if forecast_day_avg > 0:
                        forecast_night_ratio = forecast_night_avg / forecast_day_avg

                        # Reuse the same thresholds as the historical night baseline rule
                        if (
                            forecast_night_ratio >= thresholds.night_critical_ratio
                            and is_material
                        ):
                            alerts.append(
                                AlertOut(
                                    id=f"{alert_id_counter}",
                                    site_id=site_id,
                                    site_name=site_name,
                                    severity="critical",
                                    title="Forecast: high night-time baseline next 24h",
                                    message=(
                                        f"{site_name or site_id} is projected to run with a night-time "
                                        f"baseline at {forecast_night_ratio:.0%} of the day-time forecast "
                                        "over the next 24h. Without changes, off-shift hours are likely to "
                                        "carry significant idle losses."
                                    ),
                                    metric="forecast_night_baseline_ratio",
                                    window_hours=window_hours,
                                    triggered_at=now,
                                    **stats_ctx,
                                )
                            )
                            alert_id_counter += 1
                        elif forecast_night_ratio >= thresholds.night_warning_ratio:
                            alerts.append(
                                AlertOut(
                                    id=f"{alert_id_counter}",
                                    site_id=site_id,
                                    site_name=site_name,
                                    severity="warning",
                                    title="Forecast: elevated night-time baseline next 24h",
                                    message=(
                                        f"{site_name or site_id} is forecast to have night-time consumption at "
                                        f"{forecast_night_ratio:.0%} of day-time levels over the next 24h. "
                                        "Tighten shutdown procedures now to avoid avoidable off-shift waste."
                                    ),
                                    metric="forecast_night_baseline_ratio",
                                    window_hours=window_hours,
                                    triggered_at=now,
                                    **stats_ctx,
                                )
                            )
                            alert_id_counter += 1

    return alerts


def _build_site_name_map(db: Session, stats_rows) -> Dict[str, str]:
    """
    Best-effort mapping from timeseries.site_id -> human-readable site name.

    For IDs like 'site-1', we try to resolve Site(id=1). If the Site model
    is not available or the lookup fails, we simply fall back to the raw site_id.
    """
    try:
        # Import here to avoid hard failure if Site isn't exposed via app.models
        from app.models import Site  # type: ignore

        numeric_ids = set()
        for row in stats_rows:
            raw_id = row.site_id
            if not raw_id:
                continue
            parsed = _try_parse_site_numeric_id(raw_id)
            if parsed is not None:
                numeric_ids.add(parsed)

        if not numeric_ids:
            return {}

        site_rows = db.query(Site).filter(Site.id.in_(numeric_ids)).all()

        mapping: Dict[str, str] = {}
        for s in site_rows:
            label = s.name or f"Site {s.id}"
            mapping[f"site-{s.id}"] = label
            mapping[str(s.id)] = label
        return mapping
    except Exception:
        logger.exception("Failed to build site name map; falling back to raw site_id only.")
        return {}


def _try_parse_site_numeric_id(site_id: str) -> Optional[int]:
    if not site_id:
        return None
    site_id = site_id.strip()
    if site_id.startswith("site-"):
        try:
            return int(site_id.split("site-")[-1])
        except ValueError:
            return None
    try:
        return int(site_id)
    except ValueError:
        return None
