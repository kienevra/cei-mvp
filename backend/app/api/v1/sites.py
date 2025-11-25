# backend/app/api/v1/sites.py
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.v1.auth import get_current_user
from app.models import Site, User

router = APIRouter(prefix="/sites", tags=["sites"])


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
    Hard-delete a site.

    Multi-tenant behavior:
    - If user.organization_id is set -> only allow deleting sites in that org.
    - If user.organization_id is None -> fall back to legacy behavior (by id only).

    In a more mature version we'll soft-delete and handle dependent data.
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

    db.delete(site)
    db.commit()
    return
