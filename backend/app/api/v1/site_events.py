# backend/app/api/v1/site_events.py

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, Query, status, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import SiteEvent, Site

logger = logging.getLogger("cei")

router = APIRouter(prefix="/site-events", tags=["site-events"])


# --- Canonical definition: system-generated events MUST have created_by_user_id = NULL ---
# Keep this tight and explicit so you don't accidentally null out operator actions.
SYSTEM_SITE_EVENT_TYPES: Set[str] = {
    # alerts engine
    "alert_triggered",
    # baseline engine
    "baseline_deviation_high_24h",
    "baseline_deviation_low_24h",
    # add other fully-automatic types here as you create them
}


def _utcnow() -> datetime:
    # timezone-aware UTC timestamp to match DateTime(timezone=True)
    return datetime.now(timezone.utc)


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


def _normalize_site_id(raw: Optional[str]) -> Optional[str]:
    """
    Accept:
      - 'site-3'
      - '3'
      - '  site-3  '
    Return canonical 'site-<n>' when numeric is extractable.
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


def _is_system_event_row(r: SiteEvent) -> bool:
    """
    System events are identified by:
      - type in SYSTEM_SITE_EVENT_TYPES
      - created_by_user_id is NULL
    """
    try:
        return (r.type in SYSTEM_SITE_EVENT_TYPES) and (r.created_by_user_id is None)
    except Exception:
        return False


def _dedupe_system_timeline_rows(rows: List[SiteEvent]) -> List[SiteEvent]:
    """
    Prevent timeline spam from repeated polling and repeated auto-emits.

    Strategy (fail-safe and minimal):
      - Only dedupe SYSTEM events (operator notes remain untouched).
      - Keep the newest row per (site_id, type, title, body) since rows are
        ordered newest-first.
      - This collapses identical “same event” repeats while preserving distinct
        system events (e.g., high vs low, different titles/bodies).
    """
    seen: Set[Tuple[Optional[str], str, Optional[str], Optional[str]]] = set()
    out: List[SiteEvent] = []

    for r in rows:
        if not _is_system_event_row(r):
            out.append(r)
            continue

        key = (r.site_id, str(r.type), r.title, r.body)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)

    return out


class SiteEventOut(BaseModel):
    id: int
    site_id: Optional[str] = None
    site_name: Optional[str] = None

    type: str
    title: Optional[str] = None
    body: Optional[str] = None

    created_at: datetime
    created_by_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class SiteEventCreate(BaseModel):
    """
    Payload for operator-driven site events (notes, annotations, etc.).

    type:
      - "note", "operator_note", "operator_event", etc.
      - Default is "note" if omitted/blank.

    title:
      - Short label for the event (e.g. "Changed HVAC schedule").
      - Optional; if omitted and body is present, we fall back to a generic title.

    body:
      - Free-form text body for the event.

    IMPORTANT:
    - This endpoint is ONLY for operator-driven events.
    - System events (alert_triggered, baseline_deviation_*, etc.) must never be created here.
    """

    type: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None


def _resolve_org_context(user: Any) -> Tuple[Optional[int], Optional[Set[str]]]:
    """
    Resolve organization_id and allowed_site_ids from the current user.

    Mirrors the logic used in alerts, but we only actively use organization_id here.
    """
    organization_id: Optional[int] = None
    allowed_site_ids: Optional[Set[str]] = None

    try:
        org = getattr(user, "organization", None)
        if org is not None:
            if getattr(org, "id", None) is not None:
                try:
                    organization_id = int(getattr(org, "id"))
                except Exception:
                    organization_id = getattr(org, "id")

            if hasattr(org, "sites"):
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
        else:
            org_id = getattr(user, "organization_id", None)
            if org_id is not None:
                try:
                    organization_id = int(org_id)
                except Exception:
                    organization_id = org_id
    except Exception:
        logger.exception(
            "Failed to resolve organization/allowed_site_ids in site_events; "
            "falling back to unrestricted."
        )

    return organization_id, allowed_site_ids


def _build_site_name_map(db: Session, site_ids: Set[str]) -> Dict[str, str]:
    """
    Best-effort mapping from site_events.site_id (timeseries-style) -> human-readable site name.

    For IDs like 'site-1', we try to resolve Site(id=1). If the lookup fails,
    we simply fall back to the raw site_id.
    """
    if not site_ids:
        return {}

    try:
        numeric_ids: Set[int] = set()
        for raw in site_ids:
            parsed = _try_parse_site_numeric_id(raw)
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
        logger.exception(
            "Failed to build site name map in site_events; "
            "falling back to raw site_id only."
        )
        return {}


@router.get(
    "/",
    response_model=List[SiteEventOut],
    status_code=status.HTTP_200_OK,
)
def list_site_events(
    site_id: Optional[str] = Query(
        None,
        description="Optional timeseries site_id filter (e.g. 'site-1' or '1').",
    ),
    window_hours: Optional[int] = Query(
        168,
        ge=1,
        le=24 * 90,
        description="Look-back window in hours (e.g. 24, 168 for 7 days, 720 for 30 days).",
    ),
    event_type: Optional[str] = Query(
        None,
        alias="type",
        description="Optional event type filter (e.g. 'alert_triggered', 'operator_note').",
    ),
    limit: int = Query(
        100,
        ge=1,
        le=500,
        description="Maximum number of site events to return.",
    ),
    page: int = Query(
        1,
        ge=1,
        description="Page number for offset-based pagination (used together with limit).",
    ),
    dedupe: bool = Query(
        True,
        description=(
            "If true, collapses duplicate system-generated events (same site_id/type/title/body) "
            "to prevent timeline spam under repeated polling."
        ),
    ),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[SiteEventOut]:
    """
    Organization-scoped site activity timeline.

    Note on spam control:
      - By default we dedupe identical SYSTEM events (operator events are never deduped).
      - This keeps the feed useful: clients care about over/under signals, not repeated clones.
    """
    organization_id, _allowed_site_ids = _resolve_org_context(user)

    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site events require an organization context.",
        )

    now = _utcnow()
    q = db.query(SiteEvent).filter(SiteEvent.organization_id == organization_id)

    normalized_site_id = _normalize_site_id(site_id)
    if normalized_site_id:
        q = q.filter(SiteEvent.site_id == normalized_site_id)

    if window_hours is not None and window_hours > 0:
        window_start = now - timedelta(hours=window_hours)
        q = q.filter(SiteEvent.created_at >= window_start)

    if event_type:
        q = q.filter(SiteEvent.type == event_type)

    q = q.order_by(SiteEvent.created_at.desc())

    offset = (page - 1) * limit
    q = q.offset(offset).limit(limit)

    rows: List[SiteEvent] = q.all()

    if dedupe and rows:
        rows = _dedupe_system_timeline_rows(rows)

    site_ids: Set[str] = {r.site_id for r in rows if r.site_id}
    site_name_map = _build_site_name_map(db, site_ids)

    out: List[SiteEventOut] = []
    for r in rows:
        site_name = site_name_map.get(r.site_id) if r.site_id else None
        out.append(
            SiteEventOut.model_validate(
                {
                    "id": r.id,
                    "site_id": r.site_id,
                    "site_name": site_name,
                    "type": r.type,
                    "title": r.title,
                    "body": r.body,
                    "created_at": r.created_at,
                    "created_by_user_id": r.created_by_user_id,
                }
            )
        )

    return out


@router.post(
    "/sites/{site_id}/events",
    response_model=SiteEventOut,
    status_code=status.HTTP_201_CREATED,
)
def create_site_event(
    site_id: str,
    payload: SiteEventCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> SiteEventOut:
    """
    Create an operator-driven site event for a given site_id.

    Hard rule:
    - This endpoint MUST NOT allow creation of system event types.
    - Operator events always have created_by_user_id set to the current user id.
    """
    organization_id, allowed_site_ids = _resolve_org_context(user)

    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site events require an organization context.",
        )

    normalized_site_id = _normalize_site_id(site_id)
    if not normalized_site_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="site_id path parameter is required.",
        )

    # If we have an explicit list of allowed site_ids, enforce it (defense-in-depth)
    if allowed_site_ids is not None:
        # allowed_site_ids may include both 'site-<n>' and '<n>' — normalize for comparison
        normalized_allow: Set[str] = set()
        for s in allowed_site_ids:
            ns = _normalize_site_id(s)
            if ns:
                normalized_allow.add(ns)
        if normalized_site_id not in normalized_allow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Site not found in this organization.",
            )

    # Normalize type and validate minimum content
    raw_type = (payload.type or "").strip()
    event_type = raw_type or "note"

    # Block creation of system event types via this operator endpoint
    if event_type in SYSTEM_SITE_EVENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This event type is system-generated and cannot be created manually.",
        )

    title = (payload.title or "").strip() or None
    body = (payload.body or "").strip() or None

    if not title and not body:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of 'title' or 'body' must be provided.",
        )

    if title is None and body is not None:
        snippet = body.strip().splitlines()[0]
        if len(snippet) > 80:
            snippet = snippet[:77] + "..."
        title = snippet or "Operator note"

    # Operator events must always be attributed to the current user
    user_id: Optional[int]
    try:
        user_id = getattr(user, "id", None)
        if user_id is not None:
            user_id = int(user_id)
    except Exception:
        user_id = None

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cannot create an operator event without an authenticated user.",
        )

    row = SiteEvent(
        organization_id=organization_id,
        site_id=normalized_site_id,
        type=event_type,
        title=title,  # SiteEvent.title is required in your model
        body=body,
        created_at=_utcnow(),
        created_by_user_id=user_id,
    )

    db.add(row)
    db.commit()
    db.refresh(row)

    return SiteEventOut.model_validate(
        {
            "id": row.id,
            "site_id": row.site_id,
            "site_name": None,
            "type": row.type,
            "title": row.title,
            "body": row.body,
            "created_at": row.created_at,
            "created_by_user_id": row.created_by_user_id,
        }
    )
