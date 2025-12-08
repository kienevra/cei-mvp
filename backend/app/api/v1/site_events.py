# backend/app/api/v1/site_events.py

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, Query, status, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.db.models import SiteEvent

logger = logging.getLogger("cei")

router = APIRouter(prefix="/site-events", tags=["site-events"])


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


def _build_site_name_map(db: Session, site_ids: Set[str]) -> Dict[str, str]:
    """
    Best-effort mapping from timeseries.site_id -> human-readable site name.

    For IDs like 'site-1', we try to resolve Site(id=1). If the Site model
    is not available or the lookup fails, we simply fall back to the raw site_id.
    """
    if not site_ids:
        return {}

    try:
        from app.models import Site  # type: ignore

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
        description="Optional timeseries site_id filter (e.g. 'site-1').",
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
        description="Optional event type filter (e.g. 'alert_triggered', 'alert_status_changed').",
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
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[SiteEventOut]:
    """
    Organization-scoped site activity timeline.

    Returns SiteEvent rows for the caller's organization, optionally filtered by:
    - site_id (timeseries ID style, e.g. 'site-1')
    - window_hours (look-back from now)
    - type (event_type)
    - limit (max rows)
    - page (for offset-based pagination)
    """

    organization_id, _allowed_site_ids = _resolve_org_context(user)

    if organization_id is None:
        # In a true multi-tenant deployment we expect users to have an org.
        # If not, we treat it as misconfigured and fail fast.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site events require an organization context.",
        )

    now = datetime.utcnow()
    q = db.query(SiteEvent).filter(SiteEvent.organization_id == organization_id)

    if site_id:
        q = q.filter(SiteEvent.site_id == site_id)

    if window_hours is not None and window_hours > 0:
        window_start = now - timedelta(hours=window_hours)
        q = q.filter(SiteEvent.created_at >= window_start)

    if event_type:
        q = q.filter(SiteEvent.type == event_type)

    # Apply ordering, then offset + limit for pagination
    q = q.order_by(SiteEvent.created_at.desc())

    offset = (page - 1) * limit
    q = q.offset(offset).limit(limit)

    rows: List[SiteEvent] = q.all()

    # Build site name map for convenience in the UI
    site_ids: Set[str] = {r.site_id for r in rows if r.site_id}
    site_name_map = _build_site_name_map(db, site_ids)

    out: List[SiteEventOut] = []
    for r in rows:
        site_name = site_name_map.get(r.site_id)
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

    This powers the "Add note" / "Operator event" workflow in the SiteView timeline.

    Constraints:
    - Scoped to the caller's organization_id.
    - Optionally constrained by allowed_site_ids (if present).
    """
    organization_id, allowed_site_ids = _resolve_org_context(user)

    if organization_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Site events require an organization context.",
        )

    site_id = (site_id or "").strip()
    if not site_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="site_id path parameter is required.",
        )

    # If we have an explicit list of allowed site_ids, enforce it
    if allowed_site_ids is not None and site_id not in allowed_site_ids:
        # Return 404 rather than 403 to avoid leaking other orgs' site_ids
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found in this organization.",
        )

    # Normalize type and validate minimum content
    raw_type = (payload.type or "").strip()
    event_type = raw_type or "note"

    title = (payload.title or "").strip() or None
    body = (payload.body or "").strip() or None

    if not title and not body:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of 'title' or 'body' must be provided.",
        )

    if title is None and body is not None:
        # Fallback: derive a very short title from the body
        snippet = body.strip().splitlines()[0]
        if len(snippet) > 80:
            snippet = snippet[:77] + "..."
        title = snippet or "Operator note"

    created_by_user_id: Optional[int]
    try:
        created_by_user_id = getattr(user, "id", None)
    except Exception:
        created_by_user_id = None

    now = datetime.utcnow()

    row = SiteEvent(
        organization_id=organization_id,
        site_id=site_id,
        type=event_type,
        title=title,
        body=body,
        created_at=now,
        created_by_user_id=created_by_user_id,
    )

    db.add(row)
    db.commit()
    db.refresh(row)

    # We don't attempt to resolve site_name here; the GET endpoint
    # is responsible for enriching with human-readable labels.
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
