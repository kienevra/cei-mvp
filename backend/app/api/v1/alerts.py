# backend/app/api/v1/alerts.py
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Dict, Literal, Any, Set, Tuple

from fastapi import APIRouter, Depends, Query, status, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import TimeseriesRecord, AlertEvent, SiteEvent, Site  # ✅ include Site (optional cleanup)
from app.services.analytics import compute_site_insights  # statistical engine

logger = logging.getLogger("cei")

router = APIRouter(prefix="/alerts", tags=["alerts"])


# -------------------------
# Schemas
# -------------------------

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
        from_attributes = True


AlertStatus = Literal["open", "ack", "resolved", "muted"]


class AlertEventOut(BaseModel):
    id: int
    site_id: Optional[str] = None
    site_name: Optional[str] = None
    severity: str
    title: str
    message: str
    metric: Optional[str] = None
    window_hours: Optional[int] = None

    status: AlertStatus
    owner_user_id: Optional[int] = None
    note: Optional[str] = None

    triggered_at: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AlertEventUpdate(BaseModel):
    status: Optional[AlertStatus] = None
    note: Optional[str] = None


class AlertThresholdsConfig(BaseModel):
    """
    Central place to tune alert thresholds.
    """

    # Night vs day baseline
    night_warning_ratio: float = 0.4
    night_critical_ratio: float = 0.7

    # Peak vs average (short windows)
    spike_warning_ratio: float = 2.5

    # Portfolio dominance
    portfolio_share_info_ratio: float = 1.5

    # Weekend vs weekday baseline
    weekend_warning_ratio: float = 0.6
    weekend_critical_ratio: float = 0.8

    # Data quality guards
    min_points: int = 4
    min_total_kwh: float = 0.0


DEFAULT_THRESHOLDS = AlertThresholdsConfig()

SITE_THRESHOLDS: Dict[str, AlertThresholdsConfig] = {
    # "site-1": AlertThresholdsConfig(night_warning_ratio=0.5, night_critical_ratio=0.8),
}


def get_thresholds_for_site(site_id: Optional[str]) -> AlertThresholdsConfig:
    if not site_id:
        return DEFAULT_THRESHOLDS
    return SITE_THRESHOLDS.get(site_id, DEFAULT_THRESHOLDS)


# -------------------------
# Core helpers (org scoping + time)
# -------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utcnow_naive() -> datetime:
    """
    SQLite-safe 'now' (naive UTC).
    Comparing tz-aware datetimes in SQLite can behave inconsistently depending on driver/storage.
    """
    return datetime.utcnow()


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


def _normalize_site_id_param(raw: Optional[str]) -> Optional[str]:
    """
    Accepts:
      - 'site-3'
      - '3'
      - '  site-3  '
    Returns canonical 'site-<n>' when numeric is extractable, otherwise returns trimmed raw.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    n = _try_parse_site_numeric_id(s)
    if n is not None:
        return f"site-{n}"
    return s


def _resolve_org_context(user: Any) -> Tuple[Optional[int], Optional[Set[str]]]:
    """
    Resolve organization_id and allowed_site_ids.

    ✅ IMPORTANT FIX:
    Prefer user.organization_id first (reliable), then fall back to relationship.
    """
    organization_id: Optional[int] = None
    allowed_site_ids: Optional[Set[str]] = None

    try:
        raw_org_id = getattr(user, "organization_id", None)
        if raw_org_id is not None:
            try:
                organization_id = int(raw_org_id)
            except Exception:
                organization_id = raw_org_id

        org = getattr(user, "organization", None)
        if organization_id is None and org is not None and getattr(org, "id", None) is not None:
            try:
                organization_id = int(getattr(org, "id"))
            except Exception:
                organization_id = getattr(org, "id")

        # allowed_site_ids is best-effort only; do not rely on it for security.
        if org is not None and hasattr(org, "sites"):
            allowed_site_ids = {
                f"site-{s.id}"
                for s in getattr(org, "sites", [])
                if getattr(s, "id", None) is not None
            }
            if allowed_site_ids is None:
                allowed_site_ids = set()
            allowed_site_ids.update(
                {
                    str(s.id)
                    for s in getattr(org, "sites", [])
                    if getattr(s, "id", None) is not None
                }
            )
    except Exception:
        logger.exception("Failed to resolve organization/allowed_site_ids; falling back to unrestricted.")
        # leave as (maybe) None

    return organization_id, allowed_site_ids


def _user_has_alerts_enabled(db: Session, user: Any) -> bool:
    """
    Plan-level guard for alerts.

    Keep behavior: default to True on ambiguity so we don't brick dev.
    """
    try:
        org = getattr(user, "organization", None)
        if org is None:
            org_id = getattr(user, "organization_id", None)
            if org_id:
                try:
                    from app.models import Organization  # type: ignore
                    org = db.query(Organization).filter(Organization.id == org_id).first()
                except Exception:
                    org = None

        if not org:
            return True

        explicit_flag = getattr(org, "enable_alerts", None)
        if explicit_flag is not None:
            return bool(explicit_flag)

        plan_key = getattr(org, "subscription_plan_key", None) or getattr(org, "plan_key", None)
        if not plan_key:
            return True

        return plan_key in ("cei-starter", "cei-growth")
    except Exception:
        logger.exception("Failed to resolve alerts plan flag; defaulting to enabled.")
        return True


# -------------------------
# Routes
# -------------------------

@router.get("", response_model=List[AlertOut], status_code=status.HTTP_200_OK)
@router.get("/", response_model=List[AlertOut], status_code=status.HTTP_200_OK)
def list_alerts(
    window_hours: int = Query(24, ge=1, le=24 * 30, description="Look-back window in hours."),
    site_id: Optional[str] = Query(None, description="Optional timeseries site_id filter (e.g. 'site-1' or '1')."),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[AlertOut]:
    """
    Portfolio alerts computed from TimeseriesRecord.

    IMPORTANT:
    - Multi-tenant safe: all data reads are scoped by org_id when present.
    - If site_id is provided, return ONLY that site's alerts.
    - Best-effort persistence: alert_events + site_events.
    """

    if not _user_has_alerts_enabled(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alerts are not enabled for this organization/plan.",
        )

    organization_id, allowed_site_ids = _resolve_org_context(user)
    user_id: Optional[int] = getattr(user, "id", None)

    # Clamp values
    if window_hours <= 0:
        window_hours = 24
    if window_hours > 24 * 30:
        window_hours = 24 * 30

    normalized_site_id = _normalize_site_id_param(site_id)

    # If caller asked for a site_id and we have an allow-list, enforce it.
    if normalized_site_id and allowed_site_ids is not None:
        if normalized_site_id not in allowed_site_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this site_id.",
            )

    alerts = _generate_alerts_for_window(
        db=db,
        window_hours=window_hours,
        allowed_site_ids=allowed_site_ids,
        site_id=normalized_site_id,
        persist_events=True,
        organization_id=organization_id,
        user_id=user_id,
    )

    # Defensive: guarantee only requested site is returned
    if normalized_site_id:
        alerts = [a for a in alerts if a.site_id == normalized_site_id]

    return alerts


@router.get("/history", response_model=List[AlertEventOut], status_code=status.HTTP_200_OK)
def list_alert_history(
    site_id: Optional[str] = Query(None, description="Optional timeseries site_id filter (e.g. 'site-1' or '1')."),
    status_filter: Optional[AlertStatus] = Query(None, alias="status", description="open, ack, resolved, muted."),
    severity: Optional[str] = Query(None, description="critical, warning, info."),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of historical alerts to return."),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[AlertEventOut]:
    """
    Append-only historical alert stream backed by alert_events.
    """

    if not _user_has_alerts_enabled(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alerts are not enabled for this organization/plan.",
        )

    organization_id, _ = _resolve_org_context(user)
    normalized_site_id = _normalize_site_id_param(site_id)

    q = db.query(AlertEvent)

    if organization_id is not None:
        q = q.filter(AlertEvent.organization_id == organization_id)

    if normalized_site_id:
        q = q.filter(AlertEvent.site_id == normalized_site_id)

    if status_filter:
        q = q.filter(AlertEvent.status == status_filter)

    if severity:
        q = q.filter(AlertEvent.severity == severity)

    q = q.order_by(AlertEvent.triggered_at.desc()).limit(limit)
    rows = q.all()

    # Best-effort site name mapping
    site_ids = {r.site_id for r in rows if r.site_id}
    site_name_map: Dict[str, str] = {}
    if site_ids:
        try:
            numeric_ids = set()
            for raw in site_ids:
                parsed = _try_parse_site_numeric_id(raw)
                if parsed is not None:
                    numeric_ids.add(parsed)
            if numeric_ids:
                site_rows = db.query(Site).filter(Site.id.in_(numeric_ids)).all()
                for s in site_rows:
                    label = s.name or f"Site {s.id}"
                    site_name_map[f"site-{s.id}"] = label
                    site_name_map[str(s.id)] = label
        except Exception:
            logger.exception("Failed to build site name map for history; continuing without names.")

    output: List[AlertEventOut] = []
    for r in rows:
        output.append(
            AlertEventOut.model_validate(
                {
                    "id": r.id,
                    "site_id": r.site_id,
                    "site_name": site_name_map.get(r.site_id),
                    "severity": r.severity,
                    "title": r.title,
                    "message": r.message,
                    "metric": r.metric,
                    "window_hours": r.window_hours,
                    "status": r.status,
                    "owner_user_id": r.owner_user_id,
                    "note": r.note,
                    "triggered_at": r.triggered_at,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                }
            )
        )

    return output


@router.patch("/{alert_id}", response_model=AlertEventOut, status_code=status.HTTP_200_OK)
def update_alert_event(
    alert_id: int = Path(..., description="Primary key of the alert_events row."),
    payload: AlertEventUpdate = ...,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> AlertEventOut:
    """
    Update status/note for a persisted alert event.
    Emits a HUMAN SiteEvent (created_by_user_id = actor).
    """

    if not _user_has_alerts_enabled(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Alerts are not enabled for this organization/plan.",
        )

    organization_id, _ = _resolve_org_context(user)
    user_id: Optional[int] = getattr(user, "id", None)

    q = db.query(AlertEvent).filter(AlertEvent.id == alert_id)
    if organization_id is not None:
        q = q.filter(AlertEvent.organization_id == organization_id)

    alert_row = q.first()
    if not alert_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert event not found.")

    changed_fields: Dict[str, Any] = {}

    if payload.status is not None and payload.status != alert_row.status:
        alert_row.status = payload.status
        changed_fields["status"] = payload.status

    if payload.note is not None and payload.note != alert_row.note:
        alert_row.note = payload.note
        changed_fields["note"] = payload.note

    if changed_fields:
        if user_id is not None:
            alert_row.owner_user_id = user_id

        # HUMAN event into site_events (best-effort)
        try:
            # Only emit if we have an org_id (avoid org-less rows that won't show in timeline)
            org_id_for_event = getattr(alert_row, "organization_id", None)
            if org_id_for_event is not None:
                se_type = "alert_status_changed" if "status" in changed_fields else "alert_note_updated"
                body_parts: List[str] = []
                if "status" in changed_fields:
                    body_parts.append(f"Status set to '{changed_fields['status']}'.")
                if "note" in changed_fields:
                    body_parts.append("Note updated.")
                body = " ".join(body_parts) or "Alert updated."

                db.add(
                    SiteEvent(
                        organization_id=org_id_for_event,
                        site_id=getattr(alert_row, "site_id", None),
                        type=se_type,
                        title=getattr(alert_row, "title", "Alert updated"),
                        body=body,
                        created_by_user_id=user_id,
                        created_at=_utcnow(),
                    )
                )
        except Exception:
            logger.exception("Failed to create SiteEvent for alert_id=%s", alert_id)

        try:
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Failed to update AlertEvent %s", alert_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update alert event.",
            )
        db.refresh(alert_row)

    # Best-effort site name for return
    site_name: Optional[str] = None
    if alert_row.site_id:
        try:
            parsed = _try_parse_site_numeric_id(alert_row.site_id)
            if parsed is not None:
                s = db.query(Site).filter(Site.id == parsed).first()
                if s is not None:
                    site_name = s.name or f"Site {s.id}"
        except Exception:
            site_name = None

    return AlertEventOut.model_validate(
        {
            "id": alert_row.id,
            "site_id": alert_row.site_id,
            "site_name": site_name,
            "severity": alert_row.severity,
            "title": alert_row.title,
            "message": alert_row.message,
            "metric": alert_row.metric,
            "window_hours": alert_row.window_hours,
            "status": alert_row.status,
            "owner_user_id": alert_row.owner_user_id,
            "note": alert_row.note,
            "triggered_at": alert_row.triggered_at,
            "created_at": alert_row.created_at,
            "updated_at": alert_row.updated_at,
        }
    )


# -------------------------
# Internal helpers
# -------------------------

def _build_stats_context_from_insights(insights: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Normalize compute_site_insights output into a flat optional context dict.
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

    return {k: v for k, v in ctx.items() if v is not None}


def _persist_alert_events(
    db: Session,
    alerts: List[AlertOut],
    organization_id: Optional[int],
    user_id: Optional[int],
) -> None:
    """
    Best-effort append-only persistence into alert_events + site_events.

    Hard rules:
    - If organization_id is None, do NOT write.
    - SYSTEM events: created_by_user_id must be NULL.

    Dedupe (robust, SQLite/Postgres safe, idempotent under spam):
    - Never rely on DB datetime comparisons (SQLite tz-naive/tz-aware inconsistencies).
    - Treat /alerts as potentially high-QPS: do a tight identity-based dedupe in Python.
    - Identity: (org_id, site_id variants, title, metric/rule_key, window_hours)
    - Recency: within last 24h, but using a robust timestamp choice:
        prefer triggered_at (if sane), else created_at.
    - Also dedupe SiteEvent (timeline) by (org_id, site_id variants, type, title, body) + same recency logic.

    IMPORTANT CHANGE (fix for your current failure mode):
    - We do NOT "continue" the whole function when SiteEvent already exists; we just skip inserting SiteEvent.
      AlertEvent dedupe and insertion remains independent.
    - We use the SAME recency+identity logic for both, so either table won't explode under repeated calls.
    """
    if not alerts or organization_id is None:
        return

    now = _utcnow()
    dedupe_since = now - timedelta(hours=24)

    def _as_aware_utc(dt: Optional[datetime]) -> Optional[datetime]:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    def _is_recent_dt(dt: Optional[datetime]) -> bool:
        t = _as_aware_utc(dt)
        return bool(t and t >= dedupe_since)

    def _row_is_recent(row: Any) -> bool:
        # Prefer triggered_at when available; fallback to created_at.
        t = _as_aware_utc(getattr(row, "triggered_at", None)) or _as_aware_utc(getattr(row, "created_at", None))
        return bool(t and t >= dedupe_since)

    def _site_variants(sid: Optional[str]) -> List[str]:
        if not sid:
            return []
        n = _try_parse_site_numeric_id(sid)
        if n is not None:
            return [f"site-{n}", str(n)]
        return [sid]

    try:
        for a in alerts:
            try:
                sid = a.site_id
                sid_variants = _site_variants(sid)
                wh = int(a.window_hours or 0)
                rule_key = a.metric or "rule"
                metric = a.metric

                # -------------------------
                # (A) AlertEvent dedupe/insert (history)
                # -------------------------
                ae_q = (
                    db.query(AlertEvent)
                    .filter(AlertEvent.organization_id == organization_id)
                    .filter(AlertEvent.title == a.title)
                    .filter((AlertEvent.window_hours == wh) | (AlertEvent.window_hours.is_(None)))
                    .order_by(AlertEvent.created_at.desc())
                )

                if sid_variants:
                    ae_q = ae_q.filter(AlertEvent.site_id.in_(sid_variants))
                else:
                    ae_q = ae_q.filter(AlertEvent.site_id.is_(None))

                latest_ae = None
                if metric is not None:
                    latest_ae = ae_q.filter(AlertEvent.metric == metric).first()
                if latest_ae is None:
                    latest_ae = ae_q.filter(AlertEvent.rule_key == rule_key).first()

                should_insert_ae = True
                if latest_ae is not None and _row_is_recent(latest_ae):
                    should_insert_ae = False

                if should_insert_ae:
                    db.add(
                        AlertEvent(
                            organization_id=organization_id,
                            site_id=sid,
                            rule_key=rule_key,
                            severity=a.severity,
                            title=a.title,
                            message=a.message,
                            metric=metric,
                            window_hours=wh,
                            status="open",
                            owner_user_id=None,
                            note=None,
                            triggered_at=a.triggered_at,
                        )
                    )

                # -------------------------
                # (B) SiteEvent dedupe/insert (timeline) — independent from AlertEvent
                # -------------------------
                should_insert_se = True
                if sid_variants:
                    se_q = (
                        db.query(SiteEvent)
                        .filter(SiteEvent.organization_id == organization_id)
                        .filter(SiteEvent.type == "alert_triggered")
                        .filter(SiteEvent.site_id.in_(sid_variants))
                        .filter(SiteEvent.title == a.title)
                        .filter(SiteEvent.body == a.message)
                        .order_by(SiteEvent.created_at.desc())
                    )
                    latest_se = se_q.first()
                    if latest_se is not None and _is_recent_dt(getattr(latest_se, "created_at", None)):
                        should_insert_se = False
                else:
                    # no site_id => no timeline event (keeps timeline sane)
                    should_insert_se = False

                if should_insert_se:
                    db.add(
                        SiteEvent(
                            organization_id=organization_id,
                            site_id=sid,
                            type="alert_triggered",
                            title=a.title,
                            body=a.message,
                            created_by_user_id=None,
                            created_at=_utcnow(),
                        )
                    )

                # Make inserts visible to subsequent loop iterations
                try:
                    db.flush()
                except Exception:
                    pass

            except Exception:
                logger.exception("Failed to persist alert event for site_id=%s", a.site_id)

        db.commit()
    except Exception:
        logger.exception("AlertEvent persistence failed; continuing without history.")
        db.rollback()


def _build_site_name_map(db: Session, stats_rows) -> Dict[str, str]:
    """
    Best-effort mapping from timeseries.site_id -> Site.name.
    """
    try:
        numeric_ids = set()
        for row in stats_rows:
            raw_id = getattr(row, "site_id", None)
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


def _generate_alerts_for_window(
    db: Session,
    window_hours: int,
    allowed_site_ids: Optional[Set[str]] = None,
    *,
    site_id: Optional[str] = None,
    persist_events: bool = False,
    organization_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> List[AlertOut]:
    # Explicit empty allow-list => org has no sites => no alerts
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return []

    # If caller passed a site_id, enforce allow-list too (defense-in-depth)
    if site_id and allowed_site_ids is not None and site_id not in allowed_site_ids:
        return []

    # Intersect allow-list with requested site_id, if present
    effective_site_ids: Optional[Set[str]] = None
    if site_id:
        effective_site_ids = {site_id}
    elif allowed_site_ids:
        effective_site_ids = set(allowed_site_ids)

    now = _utcnow()
    window_start = now - timedelta(hours=window_hours)

    # Base stats per site_id (✅ org-scoped when organization_id is available)
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

    if organization_id is not None:
        stats_query = stats_query.filter(TimeseriesRecord.organization_id == organization_id)

    if effective_site_ids:
        stats_query = stats_query.filter(TimeseriesRecord.site_id.in_(effective_site_ids))

    stats_rows = stats_query.group_by(TimeseriesRecord.site_id).all()
    if not stats_rows:
        return []

    # Precompute statistical insights per site (baseline engine)
    insights_by_site: Dict[str, Dict[str, Any]] = {}
    for row in stats_rows:
        sid = row.site_id or "unknown"
        try:
            # ✅ FIX: pass org scope + allow-list into compute_site_insights
            insights = compute_site_insights(
                db=db,
                site_id=sid,
                window_hours=window_hours,
                lookback_days=30,
                organization_id=organization_id,
                allowed_site_ids=sorted(list(allowed_site_ids)) if allowed_site_ids is not None else None,
            )
        except Exception:
            logger.exception("Failed to compute insights for site_id=%s", sid)
            insights = None

        if insights:
            insights_by_site[sid] = insights

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

    if organization_id is not None:
        points_query = points_query.filter(TimeseriesRecord.organization_id == organization_id)

    if effective_site_ids:
        points_query = points_query.filter(TimeseriesRecord.site_id.in_(effective_site_ids))

    point_rows = points_query.all()

    night_hours = {0, 1, 2, 3, 4, 5, 22, 23}
    day_hours = {8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19}

    buckets_by_site: Dict[str, Dict[str, float]] = {}

    for row in point_rows:
        sid = row.site_id or "unknown"
        ts: datetime = row.timestamp
        try:
            val = float(row.value or 0)
        except Exception:
            val = 0.0

        bucket = buckets_by_site.get(sid)
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
            buckets_by_site[sid] = bucket

        hour = ts.hour
        if hour in night_hours:
            bucket["night_sum"] += val
            bucket["night_count"] += 1
        if hour in day_hours:
            bucket["day_sum"] += val
            bucket["day_count"] += 1

        dow = ts.weekday()  # 0=Mon ... 6=Sun
        if dow < 5:
            bucket["weekday_sum"] += val
            bucket["weekday_count"] += 1
        else:
            bucket["weekend_sum"] += val
            bucket["weekend_count"] += 1

    site_name_map: Dict[str, str] = _build_site_name_map(db, stats_rows)

    alerts: List[AlertOut] = []
    alert_id_counter = 1

    for row in stats_rows:
        sid = row.site_id or "unknown"
        total_value = float(row.total_value or 0)
        points = int(row.points or 0)
        avg_value = float(row.avg_value or 0)
        max_value = float(row.max_value or 0)
        last_ts = row.last_ts or now
        site_name = site_name_map.get(sid)

        thresholds = get_thresholds_for_site(sid)

        if points < thresholds.min_points or total_value <= thresholds.min_total_kwh:
            continue

        bucket = buckets_by_site.get(sid, {})
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

        insights = insights_by_site.get(sid)
        stats_ctx = _build_stats_context_from_insights(insights)

        night_ratio = (avg_night / avg_day) if avg_day > 0 else 0.0
        is_material = portfolio_total > 0 and total_value >= 0.2 * portfolio_total

        # Rule 1: Night baseline
        if avg_day > 0 and night_ratio >= thresholds.night_critical_ratio and is_material:
            alerts.append(
                AlertOut(
                    id=f"{alert_id_counter}",
                    site_id=sid,
                    site_name=site_name,
                    severity="critical",
                    title="High night-time baseline",
                    message=(
                        f"{site_name or sid} has a night-time baseline at "
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
                    site_id=sid,
                    site_name=site_name,
                    severity="warning",
                    title="Elevated night-time baseline",
                    message=(
                        f"{site_name or sid} shows a night-time baseline at "
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

        # Rule 2: Spike
        if window_hours <= 48 and avg_value > 0:
            spike_ratio = max_value / avg_value if avg_value > 0 else 0.0
            if spike_ratio >= thresholds.spike_warning_ratio and max_value > 0:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=sid,
                        site_name=site_name,
                        severity="warning",
                        title="Short-term peak significantly above typical load",
                        message=(
                            f"{site_name or sid} has a peak hour at {max_value:.1f} kWh, "
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

        # Rule 3: Weekend vs weekday
        if avg_weekday > 0 and avg_weekend > 0:
            weekend_ratio = avg_weekend / avg_weekday
            if weekend_ratio >= thresholds.weekend_critical_ratio and is_material:
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=sid,
                        site_name=site_name,
                        severity="critical",
                        title="Weekend baseline close to weekday levels",
                        message=(
                            f"{site_name or sid} shows weekend consumption at "
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
                        site_id=sid,
                        site_name=site_name,
                        severity="warning",
                        title="Elevated weekend baseline",
                        message=(
                            f"{site_name or sid} has weekend consumption at "
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

        # Rule 4: Portfolio dominance
        if portfolio_avg_per_site > 0:
            if total_value >= thresholds.portfolio_share_info_ratio * portfolio_avg_per_site:
                share = (total_value / portfolio_total) * 100 if portfolio_total > 0 else 0
                alerts.append(
                    AlertOut(
                        id=f"{alert_id_counter}",
                        site_id=sid,
                        site_name=site_name,
                        severity="info",
                        title="Site dominates portfolio energy",
                        message=(
                            f"{site_name or sid} is consuming {share:.1f}% of portfolio "
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

        # Rule 5: Forecasted night baseline (next 24h) using baseline_profile buckets (if present)
        baseline_profile = None
        try:
            baseline_profile = (insights or {}).get("baseline_profile") if insights else None
        except Exception:
            baseline_profile = None

        if baseline_profile and isinstance(baseline_profile, dict):
            buckets = baseline_profile.get("buckets") or []
            bucket_map: Dict[str, float] = {}

            for b in buckets:
                try:
                    h = int(b.get("hour_of_day"))
                    is_we = bool(b.get("is_weekend"))
                    mean = float(b.get("mean_kwh") or 0.0)
                except Exception:
                    continue
                bucket_map[f"{h}|{1 if is_we else 0}"] = mean

            if bucket_map:
                future_night_sum = 0.0
                future_night_count = 0.0
                future_day_sum = 0.0
                future_day_count = 0.0

                for offset in range(24):
                    ts_future = now + timedelta(hours=offset + 1)
                    h = ts_future.hour
                    is_we = ts_future.weekday() >= 5
                    mean = bucket_map.get(f"{h}|{1 if is_we else 0}", 0.0)

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

                        if forecast_night_ratio >= thresholds.night_critical_ratio and is_material:
                            alerts.append(
                                AlertOut(
                                    id=f"{alert_id_counter}",
                                    site_id=sid,
                                    site_name=site_name,
                                    severity="critical",
                                    title="Forecast: high night-time baseline next 24h",
                                    message=(
                                        f"{site_name or sid} is projected to run with a night-time "
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
                                    site_id=sid,
                                    site_name=site_name,
                                    severity="warning",
                                    title="Forecast: elevated night-time baseline next 24h",
                                    message=(
                                        f"{site_name or sid} is forecast to have night-time consumption at "
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

    if persist_events and alerts:
        _persist_alert_events(
            db=db,
            alerts=alerts,
            organization_id=organization_id,
            user_id=user_id,
        )

    return alerts
