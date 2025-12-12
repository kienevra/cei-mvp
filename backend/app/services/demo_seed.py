# backend/app/services/demo_seed.py

r"""
Unified demo seeder for CEI.

- Org A: "Dev Manufacturing" (Starter plan)
  - User: dev@cei.local / devpassword
  - Sites: 3 demo sites (Lamborghini, Ferrari, Ducati)
  - Timeseries: last 24h with high night-time waste on the 3rd site
    -> /alerts and /reports should light up nicely for Org A.

- Org B: "Org B – Demo OEM" (Starter plan)
  - User: demo2@cei.local / demo2password
  - Sites: 3 demo sites (Org B Plant 1–3)
  - Timeseries: last 24h with more "normal" patterns
    -> clean org-scoped behavior for /sites, /alerts, /reports.

Idempotent:
- Re-running this script will NOT create duplicate orgs/users/sites.
- It will wipe TimeseriesRecord rows in the last N hours and re-seed for
  both orgs.

Run from project root (PowerShell):

    .\.venv\Scripts\Activate.ps1
    cd backend
    python -m app.services.demo_seed

Run from project root (bash/zsh):

    source ./.venv/bin/activate
    cd backend
    python -m app.services.demo_seed
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Tuple

from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import Organization, User, Site, TimeseriesRecord

logger = logging.getLogger("cei")

# Use the same hashing strategy as the auth layer
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# Simple hour buckets for patterns
NIGHT_HOURS = {0, 1, 2, 3, 4, 5, 22, 23}
DAY_HOURS = {8, 9, 10, 11, 12, 13, 14, 15, 16, 17}


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _get_or_create_org(
    session: Session,
    name: str,
    plan_key: str = "cei-starter",
) -> Organization:
    org = session.query(Organization).filter(Organization.name == name).first()
    if org:
        logger.info("[demo_seed] Found existing org: %s (id=%s)", org.name, org.id)
        return org

    org = Organization(name=name)  # only safe ctor args
    session.add(org)
    session.flush()  # assign org.id

    # Try to set plan-related fields if they exist on the model.
    try:
        org.plan_key = plan_key
    except Exception:
        pass
    try:
        org.subscription_plan_key = plan_key
    except Exception:
        pass
    try:
        org.enable_alerts = True
    except Exception:
        pass
    try:
        org.enable_reports = True
    except Exception:
        pass
    try:
        org.subscription_status = "active"
    except Exception:
        pass

    session.commit()
    logger.info("[demo_seed] Created org: %s (id=%s)", org.name, org.id)
    return org


def _get_or_create_user(
    session: Session,
    org: Organization,
    email: str,
    password: str,
    as_admin: bool = False,
    role: str = "member",
) -> User:
    user = session.query(User).filter(User.email == email).first()
    if user:
        logger.info(
            "[demo_seed] Found existing user: %s (id=%s, org_id=%s)",
            user.email,
            user.id,
            getattr(user, "organization_id", None),
        )

        dirty = False

        # If user exists but organization_id is different/None, best-effort fix
        try:
            if getattr(user, "organization_id", None) != org.id:
                user.organization_id = org.id
                dirty = True
        except Exception:
            logger.exception(
                "[demo_seed] Failed to ensure org binding for user %s", user.email
            )

        # Backfill role if missing/blank (Step 4). If column doesn't exist, ignore.
        try:
            current_role = (getattr(user, "role", None) or "").strip().lower()
            desired_role = (role or "member").strip().lower()
            if not current_role:
                user.role = desired_role
                dirty = True
            # Optional: force role every run for determinism (disabled by default)
            # elif current_role != desired_role:
            #     user.role = desired_role
            #     dirty = True
        except Exception:
            pass

        # Optional: ensure admin flag if requested
        if as_admin:
            try:
                if int(getattr(user, "is_superuser", 0) or 0) != 1:
                    # IMPORTANT: use integer 1 to match INTEGER column in Supabase
                    user.is_superuser = 1
                    dirty = True
            except Exception:
                pass

        if dirty:
            session.commit()
            logger.info(
                "[demo_seed] Updated user %s (org/role/admin) where needed", user.email
            )

        return user

    hashed_password = pwd_context.hash(password)
    user = User(
        email=email,
        hashed_password=hashed_password,
        organization_id=org.id,
    )
    session.add(user)
    session.flush()

    # Set role (Step 4). If column doesn't exist, ignore.
    try:
        user.role = (role or "member").strip().lower()
    except Exception:
        pass

    # Try to mark as superuser if the column exists
    if as_admin:
        try:
            # IMPORTANT: use integer 1 to match INTEGER column in Supabase
            user.is_superuser = 1
        except Exception:
            pass

    session.commit()
    logger.info(
        "[demo_seed] Created user: %s (id=%s, org_id=%s, role=%s)",
        user.email,
        user.id,
        getattr(user, "organization_id", None),
        getattr(user, "role", None),
    )
    return user


def _get_or_create_site(
    session: Session,
    org: Organization,
    name: str,
    location: str,
) -> Site:
    site = (
        session.query(Site)
        .filter(Site.org_id == org.id, Site.name == name)
        .first()
    )
    if site:
        logger.info(
            "[demo_seed] Found existing site: %s (id=%s, org_id=%s)",
            site.name,
            site.id,
            getattr(site, "org_id", None),
        )
        return site

    site = Site(
        org_id=org.id,
        name=name,
        location=location,
    )
    session.add(site)
    session.commit()
    logger.info(
        "[demo_seed] Created site: %s (id=%s, org_id=%s)",
        site.name,
        site.id,
        getattr(site, "org_id", None),
    )
    return site


# ---------------------------------------------------------------------------
# Timeseries patterns
# ---------------------------------------------------------------------------


def _value_for_org_a(site_index: int, hour: int) -> float:
    """
    Org A pattern:
    - Sites 0 and 1: normal night/day behavior
    - Site 2: high night-time baseline (waste) to drive alerts
    """
    is_waste_site = site_index == 2  # third site

    if hour in NIGHT_HOURS:
        if is_waste_site:
            # night almost as high as day -> "waste"
            return 900.0
        return 150.0 + 30.0 * site_index  # 150 / 180

    if hour in DAY_HOURS:
        # Strong daytime load
        return 900.0 + 150.0 * site_index  # 900 / 1050 / 1200

    # Shoulder hours (morning/evening)
    if is_waste_site:
        return 1000.0
    return 300.0 + 100.0 * site_index  # 300/400/500-ish


def _value_for_org_b(site_index: int, hour: int) -> float:
    """
    Org B pattern:
    - All 3 sites behave "normally": night lower than day, moderate shoulder.
    - No extreme night waste, so alerts will be more muted vs Org A.
    """
    if hour in NIGHT_HOURS:
        return 150.0 + 30.0 * site_index  # 150 / 180 / 210

    if hour in DAY_HOURS:
        return 800.0 + 80.0 * site_index  # 800 / 880 / 960

    # Shoulder hours
    return 500.0 + 50.0 * site_index  # 500 / 550 / 600


def _seed_timeseries_for_sites(
    session: Session,
    label: str,
    sites: List[Site],
    start: datetime,
    hours: int,
    pattern: str,
) -> None:
    rows_to_insert = 0

    for idx, site in enumerate(sites):
        site_str = f"site-{site.id}"

        for i in range(hours):
            ts = start + timedelta(hours=i)
            hour = ts.hour

            if pattern == "org_a":
                val = _value_for_org_a(idx, hour)
            else:
                val = _value_for_org_b(idx, hour)

            rec = TimeseriesRecord(
                site_id=site_str,
                meter_id="meter-main-1",
                timestamp=ts,
                value=val,
                unit="kWh",
            )
            session.add(rec)
            rows_to_insert += 1

    session.commit()
    logger.info(
        "[demo_seed] Inserted %s TimeseriesRecord rows for %s sites.",
        rows_to_insert,
        label,
    )


# ---------------------------------------------------------------------------
# Org A & Org B seeding
# ---------------------------------------------------------------------------


def _seed_org_a(
    session: Session,
    start: datetime,
    hours: int,
) -> Tuple[Organization, User, List[Site]]:
    org = _get_or_create_org(session, "Dev Manufacturing", plan_key="cei-starter")
    user = _get_or_create_user(
        session,
        org,
        email="dev@cei.local",
        password="devpassword",
        as_admin=True,
        role="owner",
    )

    sites: List[Site] = []
    sites.append(
        _get_or_create_site(
            session,
            org,
            name="Lamborghini Bologna",
            location="Bologna, IT",
        )
    )
    sites.append(
        _get_or_create_site(
            session,
            org,
            name="Ferrari Modena",
            location="Modena, IT",
        )
    )
    sites.append(
        _get_or_create_site(
            session,
            org,
            name="Ducati Borgo Panigale",
            location="Bologna, IT",
        )
    )

    _seed_timeseries_for_sites(
        session=session,
        label="Org A",
        sites=sites,
        start=start,
        hours=hours,
        pattern="org_a",
    )

    return org, user, sites


def _seed_org_b(
    session: Session,
    start: datetime,
    hours: int,
) -> Tuple[Organization, User, List[Site]]:
    org = _get_or_create_org(session, "Org B – Demo OEM", plan_key="cei-starter")
    user = _get_or_create_user(
        session,
        org,
        email="demo2@cei.local",
        password="demo2password",
        as_admin=False,
        role="owner",
    )

    sites: List[Site] = []
    sites.append(
        _get_or_create_site(
            session,
            org,
            name="Org B – Plant 1",
            location="Demo Region A",
        )
    )
    sites.append(
        _get_or_create_site(
            session,
            org,
            name="Org B – Plant 2",
            location="Demo Region B",
        )
    )
    sites.append(
        _get_or_create_site(
            session,
            org,
            name="Org B – Plant 3",
            location="Demo Region C",
        )
    )

    _seed_timeseries_for_sites(
        session=session,
        label="Org B",
        sites=sites,
        start=start,
        hours=hours,
        pattern="org_b",
    )

    return org, user, sites


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("[demo_seed] Starting unified demo seed...")

    session: Session = SessionLocal()

    try:
        hours = 24

        # Align to the top of the current hour for nicer charts
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        start = now - timedelta(hours=hours)

        # Clear recent timeseries once for all orgs
        cutoff = start
        deleted = (
            session.query(TimeseriesRecord)
            .filter(TimeseriesRecord.timestamp >= cutoff)
            .delete(synchronize_session=False)
        )
        session.commit()
        logger.info(
            "[demo_seed] Cleared %s TimeseriesRecord rows newer than %s.",
            deleted,
            cutoff.isoformat(),
        )

        # Seed Org A and Org B
        _seed_org_a(session, start=start, hours=hours)
        _seed_org_b(session, start=start, hours=hours)

        logger.info(
            "[demo_seed] Done. You can now:\n"
            "  - Log in as dev@cei.local / devpassword (Org A)\n"
            "  - Log in as demo2@cei.local / demo2password (Org B)\n"
            "  - /sites, /alerts, /reports are org-scoped for each user."
        )
    finally:
        session.close()
        logger.info("[demo_seed] DB session closed.")


if __name__ == "__main__":
    main()
