# backend/app/api/v1/sites.py
from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import get_current_user
from app.models import Site, User, TimeseriesRecord
from app.db.models import SiteEvent, AlertEvent

router = APIRouter(prefix="/sites", tags=["sites"])

logger = logging.getLogger("cei")


class SiteBase(BaseModel):
    name: str
    location: Optional[str] = None


class SiteCreate(SiteBase):
    pass


class SiteRead(SiteBase):
    id: int

    class Config:
        orm_mode = True


@router.get("/", response_model=List[SiteRead])
def list_sites(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    List sites for the current user.

    Multi-tenant behavior:
    - If user.organization_id is set -> only return sites for that org.
    - If user.organization_id is None -> treat as single-tenant/dev and return all sites.
    """
    org_id = getattr(user, "organization_id", None)

    query = db.query(Site).order_by(Site.id.asc())

    if org_id is not None:
        query = query.filter(Site.org_id == org_id)

    return query.all()


@router.get("/{site_id}", response_model=SiteRead)
def get_site(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Fetch a single site.

    Multi-tenant behavior:
    - If user.organization_id is set -> enforce Site.org_id == user.organization_id.
    - If user.organization_id is None -> fall back to legacy behavior (by id only).
    """
    org_id = getattr(user, "organization_id", None)

    query = db.query(Site).filter(Site.id == site_id)

    if org_id is not None:
        query = query.filter(Site.org_id == org_id)

    site = query.first()
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found",
        )
    return site


@router.post("/", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Create a site for the current user's organization.

    Multi-tenant behavior:
    - Requires user.organization_id; sites are always attached to an org.
    - If the user has no organization, we fail fast with 400.
    """
    org_id = getattr(user, "organization_id", None)
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not attached to an organization; cannot create site.",
        )

    site = Site(
        org_id=org_id,
        name=payload.name,
        location=payload.location,
    )
    db.add(site)
    db.commit()
    db.refresh(site)
    return site


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Hard-delete a site and all of its org-scoped footprint.

    Multi-tenant behavior:
    - If user.organization_id is set -> only allow deleting sites in that org.
    - If user.organization_id is None -> fall back to legacy behavior (by id only).

    Red-pill behavior:
    - Deletes the Site row.
    - Deletes all TimeseriesRecord rows whose site_id matches this site
      (both "site-<id>" and "<id>").
    - Deletes SiteEvent timeline entries for this site.
    - Deletes AlertEvent history/workflow entries for this site.
    """
    org_id = getattr(user, "organization_id", None)

    # 1) Resolve site row with org scoping
    site_query = db.query(Site).filter(Site.id == site_id)
    if org_id is not None:
        site_query = site_query.filter(Site.org_id == org_id)

    site = site_query.first()
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found",
        )

    # We track timeseries using "site-<id>" keys; sometimes plain "<id>" leaks in.
    timeseries_keys = {f"site-{site.id}", str(site.id)}

    logger.info(
        "Deleting site %s (org_id=%s, keys=%s) with cascade",
        site.id,
        org_id,
        sorted(timeseries_keys),
    )

    # 2) Nuke timeseries data for this site_id key space
    deleted_ts = (
        db.query(TimeseriesRecord)
        .filter(TimeseriesRecord.site_id.in_(timeseries_keys))
        .delete(synchronize_session=False)
    )

    # 3) Nuke alert history/workflow rows tied to this site
    alert_q = db.query(AlertEvent).filter(AlertEvent.site_id.in_(timeseries_keys))
    if org_id is not None and hasattr(AlertEvent, "organization_id"):
        alert_q = alert_q.filter(AlertEvent.organization_id == org_id)
    deleted_alerts = alert_q.delete(synchronize_session=False)

    # 4) Nuke site timeline events tied to this site
    se_q = db.query(SiteEvent).filter(SiteEvent.site_id.in_(timeseries_keys))
    if org_id is not None and hasattr(SiteEvent, "organization_id"):
        se_q = se_q.filter(SiteEvent.organization_id == org_id)
    deleted_site_events = se_q.delete(synchronize_session=False)

    # 5) Finally delete the site row itself
    db.delete(site)
    db.commit()

    logger.info(
        "Deleted site %s cascade complete: timeseries=%s, alert_events=%s, site_events=%s",
        site_id,
        deleted_ts,
        deleted_alerts,
        deleted_site_events,
    )

    return
