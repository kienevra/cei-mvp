# backend/app/api/v1/analytics.py
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user

# Core ORM models (Organization, Site, User, TimeseriesRecord, etc.)
from app import models as core_models

# Analytics engine services
from app.services.analytics import (
    compute_site_insights,
    compute_baseline_profile,
    compute_site_forecast_stub,
)

logger = logging.getLogger("cei")

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ========= Schemas =========


class HourBandOut(BaseModel):
    hour: int
    actual_kwh: float
    expected_kwh: float
    delta_kwh: float
    delta_pct: float
    z_score: float
    band: str


class BaselineBucketOut(BaseModel):
    hour_of_day: int  # 0–23
    is_weekend: bool  # True = Saturday/Sunday
    mean_kwh: float
    std_kwh: float  # 0 if only one point in bucket


class BaselineProfileOut(BaseModel):
    """
    Statistical baseline profile for a site (and optional meter_id).

    This is purely additive: existing consumers of
    /analytics/sites/{site_id}/insights can ignore this object; new
    consumers can lean on it for richer rules/UI.
    """

    site_id: Optional[str]
    meter_id: Optional[str]
    lookback_days: int

    global_mean_kwh: Optional[float] = None
    global_p50_kwh: Optional[float] = None
    global_p90_kwh: Optional[float] = None

    n_points: int

    # Warm-up / confidence metadata
    total_history_days: Optional[int] = None
    is_warming_up: Optional[bool] = None
    confidence_level: Optional[str] = None

    buckets: List[BaselineBucketOut]


class SiteInsightsOut(BaseModel):
    """
    End-to-end insight payload for a single site.

    This preserves the existing deterministic/statistical fields and adds
    an optional `baseline_profile` section derived from compute_baseline_profile().
    """

    site_id: str
    window_hours: int
    baseline_lookback_days: int

    total_actual_kwh: float
    total_expected_kwh: float
    deviation_pct: float

    critical_hours: int
    elevated_hours: int
    below_baseline_hours: int

    hours: List[HourBandOut]
    generated_at: str

    # Warm-up / confidence metadata for the site's baseline
    total_history_days: Optional[int] = None
    is_baseline_warming_up: Optional[bool] = None
    confidence_level: Optional[str] = None

    # Richer statistical baseline (optional)
    baseline_profile: Optional[BaselineProfileOut] = None

    # ---- Cost engine: OPEX based on energy consumption ----
    actual_cost: Optional[float] = None
    expected_cost: Optional[float] = None
    cost_delta: Optional[float] = None
    currency_code: Optional[str] = None


class ForecastPointOut(BaseModel):
    ts: str
    expected_kwh: float
    lower_kwh: Optional[float] = None
    upper_kwh: Optional[float] = None
    basis: Optional[str] = None  # e.g. "stub_baseline_v1", "arima_v2" later


class SiteForecastOut(BaseModel):
    site_id: str
    history_window_hours: int
    horizon_hours: int
    baseline_lookback_days: int
    generated_at: str
    method: str  # e.g. "stub_baseline_v1"

    baseline_total_history_days: Optional[int] = None
    baseline_is_warming_up: Optional[bool] = None
    baseline_confidence_level: Optional[str] = None

    points: List[ForecastPointOut]


class SiteKpiOut(BaseModel):
    site_id: str
    now_utc: datetime

    last_24h_kwh: float
    baseline_24h_kwh: Optional[float] = None
    deviation_pct_24h: Optional[float] = None

    last_7d_kwh: float
    prev_7d_kwh: Optional[float] = None
    deviation_pct_7d: Optional[float] = None

    total_history_days: Optional[int] = None
    is_baseline_warming_up: Optional[bool] = None
    confidence_level: Optional[str] = None

    # ---- Cost engine KPIs ----
    last_24h_cost: Optional[float] = None
    expected_24h_cost: Optional[float] = None
    cost_savings_24h: Optional[float] = None

    last_7d_cost: Optional[float] = None
    expected_7d_cost: Optional[float] = None
    cost_savings_7d: Optional[float] = None

    currency_code: Optional[str] = None


# ========= Helpers =========

# Keep this set local to analytics since we should not import API modules from other routers
# (avoids circular imports). This set is ONLY used for "system emits" logic here.
SYSTEM_SITE_EVENT_TYPES: Set[str] = {
    "kpi_overspend_24h",
    "kpi_savings_24h",
    "baseline_deviation_high_24h",
    "baseline_deviation_low_24h",
}


def _try_parse_site_numeric_id(site_id: str) -> Optional[int]:
    if not site_id:
        return None
    s = site_id.strip()
    if s.startswith("site-"):
        try:
            return int(s.split("site-")[-1])
        except ValueError:
            return None
    try:
        return int(s)
    except ValueError:
        return None


def _normalize_site_id(site_id: str) -> str:
    n = _try_parse_site_numeric_id(site_id)
    return f"site-{n}" if n is not None else site_id.strip()


def _resolve_org_context(user: Any) -> Tuple[Optional[int], Optional[int]]:
    org_id: Optional[int] = None
    try:
        raw = getattr(user, "organization_id", None)
        if raw is not None:
            org_id = int(raw)
    except Exception:
        org_id = None

    if org_id is None:
        try:
            org = getattr(user, "organization", None)
            if org is not None and getattr(org, "id", None) is not None:
                org_id = int(getattr(org, "id"))
        except Exception:
            org_id = None

    user_id: Optional[int] = None
    try:
        if getattr(user, "id", None) is not None:
            user_id = int(getattr(user, "id"))
    except Exception:
        user_id = None

    return org_id, user_id


def _get_allowed_site_ids(db: Session, org_id: Optional[int]) -> Optional[Set[str]]:
    if org_id is None:
        return None
    try:
        rows = (
            db.query(core_models.Site.id)
            .filter(core_models.Site.org_id == org_id)
            .all()
        )
        ids = {int(r[0]) for r in rows if r and r[0] is not None}
        out: Set[str] = set()
        for n in ids:
            out.add(f"site-{n}")
            out.add(str(n))
        return out
    except Exception:
        logger.exception("Failed to build allowed_site_ids for org_id=%s", org_id)
        return None


def _enforce_site_access(
    *,
    db: Session,
    org_id: Optional[int],
    site_id_raw: str,
) -> str:
    site_id_canon = _normalize_site_id(site_id_raw)

    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization context is missing; access denied.",
        )

    n = _try_parse_site_numeric_id(site_id_canon)
    if n is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid site_id format.",
        )

    site_row = (
        db.query(core_models.Site)
        .filter(core_models.Site.id == n)
        .filter(core_models.Site.org_id == org_id)
        .first()
    )
    if site_row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this site_id.",
        )

    return f"site-{n}"


def _build_empty_insights_payload(
    *,
    site_id: str,
    window_hours: int,
    lookback_days: int,
    baseline_profile: Optional[BaselineProfileOut] = None,
) -> SiteInsightsOut:
    now_iso = datetime.now(timezone.utc).isoformat()

    total_history_days = (
        baseline_profile.total_history_days
        if baseline_profile and baseline_profile.total_history_days is not None
        else None
    )

    return SiteInsightsOut(
        site_id=site_id,
        window_hours=window_hours,
        baseline_lookback_days=lookback_days,
        total_actual_kwh=0.0,
        total_expected_kwh=0.0,
        deviation_pct=0.0,
        critical_hours=0,
        elevated_hours=0,
        below_baseline_hours=0,
        hours=[],
        generated_at=now_iso,
        total_history_days=total_history_days,
        is_baseline_warming_up=True,
        confidence_level="warming_up",
        baseline_profile=baseline_profile,
        actual_cost=None,
        expected_cost=None,
        cost_delta=None,
        currency_code=None,
    )


def _build_empty_kpi_payload(
    *,
    site_id: str,
    lookback_days: int,
) -> SiteKpiOut:
    now = datetime.now(timezone.utc)

    return SiteKpiOut(
        site_id=site_id,
        now_utc=now,
        last_24h_kwh=0.0,
        baseline_24h_kwh=None,
        deviation_pct_24h=None,
        last_7d_kwh=0.0,
        prev_7d_kwh=None,
        deviation_pct_7d=None,
        total_history_days=None,
        is_baseline_warming_up=True,
        confidence_level="warming_up",
        last_24h_cost=None,
        expected_24h_cost=None,
        cost_savings_24h=None,
        last_7d_cost=None,
        expected_7d_cost=None,
        cost_savings_7d=None,
        currency_code=None,
    )


def _get_org_for_user(
    db: Session,
    user: Any,
) -> Optional[core_models.Organization]:
    org = getattr(user, "organization", None)
    if org is not None:
        return org

    org_id = getattr(user, "organization_id", None)
    if not org_id:
        return None

    return (
        db.query(core_models.Organization)
        .filter(core_models.Organization.id == org_id)
        .first()
    )


def _compute_cost_from_kwh(
    *,
    actual_kwh: float,
    expected_kwh: Optional[float],
    org: Optional[core_models.Organization],
) -> Dict[str, Optional[float]]:
    if org is None:
        return {
            "actual_cost": None,
            "expected_cost": None,
            "cost_delta": None,
            "currency_code": None,
        }

    price = getattr(org, "electricity_price_per_kwh", None)
    if price is None:
        return {
            "actual_cost": None,
            "expected_cost": None,
            "cost_delta": None,
            "currency_code": getattr(org, "currency_code", None),
        }

    try:
        actual_cost = float(actual_kwh) * float(price)
    except Exception:
        actual_cost = None

    if expected_kwh is not None:
        try:
            expected_cost = float(expected_kwh) * float(price)
        except Exception:
            expected_cost = None
    else:
        expected_cost = None

    if actual_cost is not None and expected_cost is not None:
        cost_delta = actual_cost - expected_cost
    else:
        cost_delta = None

    return {
        "actual_cost": actual_cost,
        "expected_cost": expected_cost,
        "cost_delta": cost_delta,
        "currency_code": getattr(org, "currency_code", None),
    }


def _maybe_emit_kpi_site_events(
    *,
    db: Session,
    org_id: Optional[int],
    site_id: str,
    created_by_user_id: Optional[int],
    last_24h_kwh: float,
    baseline_24h_kwh: Optional[float],
    deviation_pct_24h: Optional[float],
    last_24h_cost: Optional[float],
    expected_24h_cost: Optional[float],
    cost_savings_24h: Optional[float],
    currency_code: Optional[str],
) -> None:
    """
    Emit system-generated site events from KPI/baseline signals.

    IMPORTANT:
    - These are SYSTEM events: created_by_user_id MUST remain NULL.
    - Must use correct ORM attribute names per models.py:
        SiteEvent.organization_id (DB column org_id)
        SiteEvent.type            (DB column kind)
        SiteEvent.body            (DB column description)
    """
    if org_id is None:
        return

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)

    site_id = _normalize_site_id(site_id)

    COST_ABS_THRESHOLD = 10.0
    DEV_PCT_THRESHOLD = 10.0

    def already_emitted(event_type: str) -> bool:
        existing = (
            db.query(core_models.SiteEvent)
            .filter(core_models.SiteEvent.organization_id == org_id)
            .filter(core_models.SiteEvent.site_id == site_id)
            .filter(core_models.SiteEvent.type == event_type)
            .filter(core_models.SiteEvent.created_at >= window_start)
            .first()
        )
        return existing is not None

    def stage(event_type: str, title: str, body: Optional[str]) -> None:
        if already_emitted(event_type):
            return
        row = core_models.SiteEvent(
            organization_id=org_id,
            site_id=site_id,
            type=event_type,
            title=title,
            body=body,
            created_by_user_id=None,  # SYSTEM event
            created_at=now,
        )
        db.add(row)

    if cost_savings_24h is not None and expected_24h_cost is not None and last_24h_cost is not None:
        cur = (currency_code or "").strip() or ""

        if cost_savings_24h <= -COST_ABS_THRESHOLD:
            overspend = abs(cost_savings_24h)
            title = f"Overspend last 24h: {cur} {overspend:.2f}".strip()
            body = (
                f"Actual: {cur} {last_24h_cost:.2f} vs Expected: {cur} {expected_24h_cost:.2f}.\n"
                f"Energy: {last_24h_kwh:.2f} kWh"
                + (f" vs Baseline: {baseline_24h_kwh:.2f} kWh" if baseline_24h_kwh is not None else "")
                + (f" ({deviation_pct_24h:+.1f}%)" if deviation_pct_24h is not None else "")
            )
            stage("kpi_overspend_24h", title, body)

        if cost_savings_24h >= COST_ABS_THRESHOLD:
            title = f"Savings last 24h: {cur} {cost_savings_24h:.2f}".strip()
            body = (
                f"Actual: {cur} {last_24h_cost:.2f} vs Expected: {cur} {expected_24h_cost:.2f}.\n"
                f"Energy: {last_24h_kwh:.2f} kWh"
                + (f" vs Baseline: {baseline_24h_kwh:.2f} kWh" if baseline_24h_kwh is not None else "")
                + (f" ({deviation_pct_24h:+.1f}%)" if deviation_pct_24h is not None else "")
            )
            stage("kpi_savings_24h", title, body)

    if deviation_pct_24h is not None:
        if deviation_pct_24h >= DEV_PCT_THRESHOLD:
            title = f"High deviation vs baseline (24h): {deviation_pct_24h:+.1f}%"
            body = (
                f"Actual: {last_24h_kwh:.2f} kWh"
                + (f" vs Baseline: {baseline_24h_kwh:.2f} kWh" if baseline_24h_kwh is not None else "")
            )
            stage("baseline_deviation_high_24h", title, body)

        if deviation_pct_24h <= -DEV_PCT_THRESHOLD:
            title = f"Low usage vs baseline (24h): {deviation_pct_24h:+.1f}%"
            body = (
                f"Actual: {last_24h_kwh:.2f} kWh"
                + (f" vs Baseline: {baseline_24h_kwh:.2f} kWh" if baseline_24h_kwh is not None else "")
            )
            stage("baseline_deviation_low_24h", title, body)

    try:
        db.commit()
    except Exception:
        db.rollback()


# ========= Routes =========


@router.get(
    "/sites/{site_id}/insights",
    response_model=SiteInsightsOut,
    status_code=status.HTTP_200_OK,
)
def get_site_insights(
    site_id: str,
    window_hours: int = Query(24, ge=1, le=24 * 7),
    lookback_days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> SiteInsightsOut:
    org = _get_org_for_user(db, user)
    org_id, user_id = _resolve_org_context(user)

    site_id_canon = _enforce_site_access(db=db, org_id=org_id, site_id_raw=site_id)

    allowed_site_ids = _get_allowed_site_ids(db, org_id)

    baseline = compute_baseline_profile(
        db=db,
        site_id=site_id_canon,
        meter_id=None,
        lookback_days=lookback_days,
        allowed_site_ids=sorted(list(allowed_site_ids)) if allowed_site_ids is not None else None,
        organization_id=org_id,
    )

    baseline_profile_out: Optional[BaselineProfileOut] = None
    if baseline is not None:
        bucket_outs: List[BaselineBucketOut] = [
            BaselineBucketOut(
                hour_of_day=b.hour_of_day,
                is_weekend=b.is_weekend,
                mean_kwh=b.mean_kwh,
                std_kwh=b.std_kwh,
            )
            for b in baseline.buckets
        ]

        baseline_profile_out = BaselineProfileOut(
            site_id=baseline.site_id,
            meter_id=baseline.meter_id,
            lookback_days=baseline.lookback_days,
            global_mean_kwh=baseline.global_mean,
            global_p50_kwh=baseline.global_p50,
            global_p90_kwh=baseline.global_p90,
            n_points=baseline.n_points,
            total_history_days=baseline.total_history_days,
            is_warming_up=baseline.is_warming_up,
            confidence_level=baseline.confidence_level,
            buckets=bucket_outs,
        )

    try:
        insights: Optional[Dict[str, Any]] = compute_site_insights(
            db=db,
            site_id=site_id_canon,
            window_hours=window_hours,
            lookback_days=lookback_days,
            organization_id=org_id,
            allowed_site_ids=sorted(list(allowed_site_ids)) if allowed_site_ids is not None else None,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return _build_empty_insights_payload(
                site_id=site_id_canon,
                window_hours=window_hours,
                lookback_days=lookback_days,
                baseline_profile=baseline_profile_out,
            )
        raise

    if not insights:
        return _build_empty_insights_payload(
            site_id=site_id_canon,
            window_hours=window_hours,
            lookback_days=lookback_days,
            baseline_profile=baseline_profile_out,
        )

    raw_hours = insights.get("hours", []) or []
    hours_out: List[HourBandOut] = []
    for h in raw_hours:
        hours_out.append(
            HourBandOut(
                hour=int(h.get("hour", 0)),
                actual_kwh=float(h.get("actual_kwh", 0.0)),
                expected_kwh=float(h.get("expected_kwh", 0.0)),
                delta_kwh=float(h.get("delta_kwh", 0.0)),
                delta_pct=float(h.get("delta_pct", 0.0)),
                z_score=float(h.get("z_score", 0.0)),
                band=str(h.get("band", "normal")),
            )
        )

    raw_total_history_days = insights.get("total_history_days")
    total_history_days: Optional[int] = (
        int(raw_total_history_days) if raw_total_history_days is not None else None
    )
    is_baseline_warming_up: Optional[bool] = insights.get("is_baseline_warming_up")
    confidence_level: Optional[str] = insights.get("confidence_level")

    total_actual_kwh = float(insights.get("total_actual_kwh", 0.0))
    total_expected_raw = insights.get("total_expected_kwh")
    total_expected_kwh: float = float(total_expected_raw) if total_expected_raw is not None else 0.0

    cost_info = _compute_cost_from_kwh(
        actual_kwh=total_actual_kwh,
        expected_kwh=total_expected_kwh if total_expected_raw is not None else None,
        org=org,
    )

    try:
        if int(window_hours) == 24:
            deviation_pct = insights.get("deviation_pct")

            last_24h_cost = cost_info["actual_cost"]
            expected_24h_cost = cost_info["expected_cost"]
            cost_savings_24h: Optional[float] = None
            if last_24h_cost is not None and expected_24h_cost is not None:
                cost_savings_24h = expected_24h_cost - last_24h_cost

            _maybe_emit_kpi_site_events(
                db=db,
                org_id=org_id,
                site_id=site_id_canon,
                created_by_user_id=user_id,
                last_24h_kwh=float(total_actual_kwh or 0.0),
                baseline_24h_kwh=float(total_expected_raw) if total_expected_raw is not None else None,
                deviation_pct_24h=float(deviation_pct) if deviation_pct is not None else None,
                last_24h_cost=last_24h_cost,
                expected_24h_cost=expected_24h_cost,
                cost_savings_24h=cost_savings_24h,
                currency_code=cost_info["currency_code"],
            )
    except Exception:
        pass

    return SiteInsightsOut(
        site_id=str(insights.get("site_id", site_id_canon)),
        window_hours=int(insights.get("window_hours", window_hours)),
        baseline_lookback_days=int(insights.get("baseline_lookback_days", lookback_days)),
        total_actual_kwh=total_actual_kwh,
        total_expected_kwh=total_expected_kwh,
        deviation_pct=float(insights.get("deviation_pct", 0.0)),
        critical_hours=int(insights.get("critical_hours", 0)),
        elevated_hours=int(insights.get("elevated_hours", 0)),
        below_baseline_hours=int(insights.get("below_baseline_hours", 0)),
        hours=hours_out,
        generated_at=str(insights.get("generated_at", "")),
        total_history_days=total_history_days,
        is_baseline_warming_up=is_baseline_warming_up,
        confidence_level=confidence_level,
        baseline_profile=baseline_profile_out,
        actual_cost=cost_info["actual_cost"],
        expected_cost=cost_info["expected_cost"],
        cost_delta=cost_info["cost_delta"],
        currency_code=cost_info["currency_code"],
    )


@router.get(
    "/sites/{site_id}/kpi",
    response_model=SiteKpiOut,
    status_code=status.HTTP_200_OK,
)
def get_site_kpi(
    site_id: str,
    lookback_days: int = Query(
        30,
        ge=7,
        le=365,
        description="Lookback window in days used to build the statistical baseline for 24h comparison.",
    ),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> SiteKpiOut:
    now = datetime.now(timezone.utc)
    org = _get_org_for_user(db, user)
    org_id, user_id = _resolve_org_context(user)

    site_id_canon = _enforce_site_access(db=db, org_id=org_id, site_id_raw=site_id)
    allowed_site_ids = _get_allowed_site_ids(db, org_id)

    try:
        insights_24h: Optional[Dict[str, Any]] = compute_site_insights(
            db=db,
            site_id=site_id_canon,
            window_hours=24,
            lookback_days=lookback_days,
            organization_id=org_id,
            allowed_site_ids=sorted(list(allowed_site_ids)) if allowed_site_ids is not None else None,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            return _build_empty_kpi_payload(site_id=site_id_canon, lookback_days=lookback_days)
        raise

    if not insights_24h:
        return _build_empty_kpi_payload(site_id=site_id_canon, lookback_days=lookback_days)

    last_24h_kwh = float(insights_24h.get("total_actual_kwh", 0.0))

    baseline_expected = insights_24h.get("total_expected_kwh")
    baseline_24h_kwh: Optional[float] = (
        float(baseline_expected) if baseline_expected is not None else None
    )

    deviation_pct_24h: Optional[float] = None
    if baseline_24h_kwh is not None and baseline_24h_kwh != 0.0:
        deviation_pct_24h = (last_24h_kwh - baseline_24h_kwh) / baseline_24h_kwh * 100.0

    raw_total_history_days = insights_24h.get("total_history_days")
    total_history_days: Optional[int] = (
        int(raw_total_history_days) if raw_total_history_days is not None else None
    )
    is_baseline_warming_up: Optional[bool] = insights_24h.get("is_baseline_warming_up")
    confidence_level: Optional[str] = insights_24h.get("confidence_level")

    cost_24h = _compute_cost_from_kwh(
        actual_kwh=last_24h_kwh,
        expected_kwh=baseline_24h_kwh,
        org=org,
    )
    last_24h_cost = cost_24h["actual_cost"]
    expected_24h_cost = cost_24h["expected_cost"]
    cost_savings_24h: Optional[float] = None
    if last_24h_cost is not None and expected_24h_cost is not None:
        cost_savings_24h = expected_24h_cost - last_24h_cost

    try:
        insights_7d: Optional[Dict[str, Any]] = compute_site_insights(
            db=db,
            site_id=site_id_canon,
            window_hours=24 * 7,
            lookback_days=lookback_days,
            organization_id=org_id,
            allowed_site_ids=sorted(list(allowed_site_ids)) if allowed_site_ids is not None else None,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            insights_7d = None
        else:
            raise

    if insights_7d:
        last_7d_kwh = float(insights_7d.get("total_actual_kwh", 0.0))
        baseline_7d_raw = insights_7d.get("total_expected_kwh")
        baseline_7d_kwh: Optional[float] = (
            float(baseline_7d_raw) if baseline_7d_raw is not None else None
        )
    else:
        last_7d_kwh = 0.0
        baseline_7d_kwh = None

    prev_7d_kwh: Optional[float] = None
    deviation_pct_7d: Optional[float] = None

    cost_7d = _compute_cost_from_kwh(
        actual_kwh=last_7d_kwh,
        expected_kwh=baseline_7d_kwh,
        org=org,
    )
    last_7d_cost = cost_7d["actual_cost"]
    expected_7d_cost = cost_7d["expected_cost"]
    cost_savings_7d: Optional[float] = None
    if last_7d_cost is not None and expected_7d_cost is not None:
        cost_savings_7d = expected_7d_cost - last_7d_cost

    currency_code = cost_24h["currency_code"] or cost_7d["currency_code"]

    try:
        _maybe_emit_kpi_site_events(
            db=db,
            org_id=org_id,
            site_id=site_id_canon,
            created_by_user_id=user_id,
            last_24h_kwh=last_24h_kwh,
            baseline_24h_kwh=baseline_24h_kwh,
            deviation_pct_24h=deviation_pct_24h,
            last_24h_cost=last_24h_cost,
            expected_24h_cost=expected_24h_cost,
            cost_savings_24h=cost_savings_24h,
            currency_code=currency_code,
        )
    except Exception:
        pass

    return SiteKpiOut(
        site_id=_normalize_site_id(site_id_canon),
        now_utc=now,
        last_24h_kwh=last_24h_kwh,
        baseline_24h_kwh=baseline_24h_kwh,
        deviation_pct_24h=deviation_pct_24h,
        last_7d_kwh=last_7d_kwh,
        prev_7d_kwh=prev_7d_kwh,
        deviation_pct_7d=deviation_pct_7d,
        total_history_days=total_history_days,
        is_baseline_warming_up=is_baseline_warming_up,
        confidence_level=confidence_level,
        last_24h_cost=last_24h_cost,
        expected_24h_cost=expected_24h_cost,
        cost_savings_24h=cost_savings_24h,
        last_7d_cost=last_7d_cost,
        expected_7d_cost=expected_7d_cost,
        cost_savings_7d=cost_savings_7d,
        currency_code=currency_code,
    )


@router.get(
    "/sites/{site_id}/forecast",
    response_model=SiteForecastOut,
    status_code=status.HTTP_200_OK,
)
def get_site_forecast(
    site_id: str,
    history_window_hours: int = Query(
        24,
        ge=1,
        le=24 * 7,
        description="History window in hours used to compute recent deviation vs baseline.",
    ),
    horizon_hours: int = Query(
        24,
        ge=1,
        le=24 * 7,
        description="Forecast horizon in hours.",
    ),
    lookback_days: int = Query(
        30,
        ge=7,
        le=365,
        description="Lookback window in days used to build the statistical baseline.",
    ),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> SiteForecastOut:
    org_id, _ = _resolve_org_context(user)
    site_id_canon = _enforce_site_access(db=db, org_id=org_id, site_id_raw=site_id)

    allowed_site_ids = _get_allowed_site_ids(db, org_id)

    forecast = compute_site_forecast_stub(
        db=db,
        site_id=site_id_canon,
        history_window_hours=history_window_hours,
        horizon_hours=horizon_hours,
        lookback_days=lookback_days,
        allowed_site_ids=sorted(list(allowed_site_ids)) if allowed_site_ids is not None else None,
        organization_id=org_id,
    )

    if not forecast:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not enough data to generate a forecast for this site.",
        )

    raw_points = forecast.get("points", []) or []
    points_out: List[ForecastPointOut] = []
    for p in raw_points:
        points_out.append(
            ForecastPointOut(
                ts=str(p.get("ts")),
                expected_kwh=float(p.get("expected_kwh", 0.0)),
                lower_kwh=(
                    float(p["lower_kwh"])
                    if "lower_kwh" in p and p["lower_kwh"] is not None
                    else None
                ),
                upper_kwh=(
                    float(p["upper_kwh"])
                    if "upper_kwh" in p and p["upper_kwh"] is not None
                    else None
                ),
                basis=p.get("basis"),
            )
        )

    return SiteForecastOut(
        site_id=str(forecast.get("site_id", _normalize_site_id(site_id_canon))),
        history_window_hours=int(forecast.get("history_window_hours", history_window_hours)),
        horizon_hours=int(forecast.get("horizon_hours", horizon_hours)),
        baseline_lookback_days=int(forecast.get("baseline_lookback_days", lookback_days)),
        generated_at=str(forecast.get("generated_at", "")),
        method=str(forecast.get("method", "stub_baseline_v1")),
        baseline_total_history_days=forecast.get("baseline_total_history_days"),
        baseline_is_warming_up=forecast.get("baseline_is_warming_up"),
        baseline_confidence_level=forecast.get("baseline_confidence_level"),
        points=points_out,
    )
