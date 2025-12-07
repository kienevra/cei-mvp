# backend/app/api/v1/sites.py
from typing import List, Optional
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.models import Site, User, TimeseriesRecord  # ← Site/User/TimeseriesRecord live here
from app.db.models import SiteEvent  # ← SiteEvent lives here

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
    Hard-delete a site AND all org-scoped data that uses its site_id key.

    This ensures that if a new site is later created with the same numeric ID
    (and therefore the same timeseries site_id like "site-1"), it starts with
    a clean slate.

    Multi-tenant behavior:
    - Requires user.organization_id; sites are always attached to an org.
    """
    org_id = getattr(user, "organization_id", None)
    if org_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sites are scoped to an organization.",
        )

    site: Site | None = (
        db.query(Site)
        .filter(Site.id == site_id, Site.org_id == org_id)
        .first()
    )
    if site is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found",
        )

    # Timeseries uses string keys like "site-1"; some legacy data might just use "1".
    site_key = f"site-{site.id}"
    legacy_key = str(site.id)

    logger.info(
        "Deleting site %s (org_id=%s, keys=[%s, %s]) with cascade",
        site.id,
        org_id,
        site_key,
        legacy_key,
    )

    # 1) Delete timeseries rows for this site key
    ts_deleted = (
        db.query(TimeseriesRecord)
        .filter(
            TimeseriesRecord.organization_id == org_id,
            TimeseriesRecord.site_id.in_([site_key, legacy_key]),
        )
        .delete(synchronize_session=False)
    )

    # 2) Delete site-level events/timeline rows
    se_deleted = (
        db.query(SiteEvent)
        .filter(
            SiteEvent.organization_id == org_id,
            SiteEvent.site_id.in_([site_key, legacy_key]),
        )
        .delete(synchronize_session=False)
    )

    # 3) (OPTIONAL, best-effort) Delete alert events if model exists
    ae_deleted = 0
    try:
        from app.db.models import AlertEvent  # type: ignore

        ae_deleted = (
            db.query(AlertEvent)
            .filter(
                AlertEvent.organization_id == org_id,
                AlertEvent.site_id.in_([site_key, legacy_key]),
            )
            .delete(synchronize_session=False)
        )
    except Exception:
        logger.exception(
            "Failed to cascade-delete AlertEvent rows for site=%s", site.id
        )

    logger.info(
        "Cascade delete for site %s (org_id=%s): timeseries=%s, site_events=%s, alert_events=%s",
        site.id,
        org_id,
        ts_deleted,
        se_deleted,
        ae_deleted,
    )

    # Finally, remove the Site itself
    db.delete(site)
    db.commit()
    return
