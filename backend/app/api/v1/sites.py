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
  # Later we can filter by organization_id
  return db.query(Site).order_by(Site.id.asc()).all()


@router.get("/{site_id}", response_model=SiteRead)
def get_site(
  site_id: int,
  db: Session = Depends(get_db),
  user: User = Depends(get_current_user),
):
  site = db.query(Site).filter(Site.id == site_id).first()
  if not site:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND, detail="Site not found"
    )
  return site


@router.post("/", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(
  payload: SiteCreate,
  db: Session = Depends(get_db),
  user: User = Depends(get_current_user),
):
  # For now, if user.organization_id is null, we default org to 1
  org_id = user.organization_id if user.organization_id is not None else 1

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

  In a more mature version we'll restrict this by org, handle
  dependencies more carefully, and possibly soft-delete instead.
  """
  site = db.query(Site).filter(Site.id == site_id).first()
  if not site:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND, detail="Site not found"
    )

  # TODO: enforce same organization, check for dependent data policies.
  db.delete(site)
  db.commit()
  return
