from typing import Optional, Set, Any

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import User, Organization, Site, TimeseriesRecord
from app.api.v1.auth import get_current_user


def get_current_active_user(
    user: User = Depends(get_current_user),
) -> User:
    """
    Wrapper around auth.get_current_user.

    In future, you can enforce is_active here.
    """
    return user


def get_current_org(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
) -> Optional[Organization]:
    """
    Resolve the Organization for the current user, if any.
    """
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        return None

    return db.query(Organization).filter(Organization.id == org_id).first()


def get_org_allowed_site_ids(
    db: Session,
    org_id: int,
) -> Set[str]:
    """
    Compute the set of timeseries.site_id values that belong to this org.

    We support both:
    - 'site-{id}' style keys
    - raw numeric string ids ('1', '2', ...)
    """
    site_rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    allowed: Set[str] = set()
    for (site_id,) in site_rows:
        allowed.add(f"site-{site_id}")
        allowed.add(str(site_id))
    return allowed


def apply_org_scope_to_timeseries_query(
    query,
    db: Session,
    user: Any,
):
    """
    Given a SQLAlchemy query on TimeseriesRecord, constrain it to the
    current user's organization (if any).

    Usage in /timeseries endpoints:
        query = db.query(TimeseriesRecord).filter(...)
        query = apply_org_scope_to_timeseries_query(query, db, user)
    """
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        # No org concept -> single-tenant/dev, no restriction
        return query

    allowed = get_org_allowed_site_ids(db, org_id)
    if not allowed:
        # Force an empty result set
        return query.filter(TimeseriesRecord.site_id == "__no_such_site__")

    return query.filter(TimeseriesRecord.site_id.in_(allowed))
