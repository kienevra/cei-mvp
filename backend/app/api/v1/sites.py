from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Site
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/sites", tags=["sites"])


class SiteBase(BaseModel):
  name: str
  location: Optional[str] = None


class SiteCreate(SiteBase):
  # For now, org_id is implicit (we'll use the user's org if present)
  pass


class SiteOut(SiteBase):
  id: int

  class Config:
    orm_mode = True


@router.get("/", response_model=List[SiteOut])
def list_sites(
  db: Session = Depends(get_db),
  user=Depends(get_current_user),
):
  """
  List sites. For now, returns all sites; later we can scope by user.organization_id.
  """
  sites = db.query(Site).all()
  return sites


@router.post("/", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_site(
  payload: SiteCreate,
  db: Session = Depends(get_db),
  user=Depends(get_current_user),
):
  """
  Create a site.

  For dev:
  - org_id comes from the user if available.
  - If user.organization_id is None, we just leave org_id null.
  """
  site = Site(
    name=payload.name,
    location=payload.location,
    org_id=getattr(user, "organization_id", None),
  )
  db.add(site)
  db.commit()
  db.refresh(site)
  return site
@router.get("/{site_id}", response_model=SiteOut)
def get_site(
  site_id: int,
  db: Session = Depends(get_db),
  user=Depends(get_current_user),
):
  """
  Get a single site by id.
  Later we can restrict this to the user's organization.
  """
  site = db.query(Site).filter(Site.id == site_id).first()
  if not site:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
  return site
