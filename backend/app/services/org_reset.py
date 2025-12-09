# backend/app/services/org_reset.py

from __future__ import annotations

import logging
from typing import Dict, Any, Iterable, Set

from sqlalchemy.orm import Session

from app.models import Site, TimeseriesRecord
from app.db.models import SiteEvent, AlertEvent

logger = logging.getLogger("cei")


def _site_timeseries_keys(site_id: int) -> Set[str]:
  """
  Build the key space used in timeseries + event tables for a given site.

  We use both:
  - "site-<id>"  (canonical CEI timeseries key)
  - "<id>"       (legacy / accidental key that sometimes leaks in)
  """
  return {f"site-{site_id}", str(site_id)}


def purge_org_data(
  db: Session,
  org_id: int,
) -> Dict[str, Any]:
  """
  Hard-delete all site-scoped data for a given organization.

  This is intended for:
  - Test fixtures (resetting demo orgs between tests).
  - Local/dev maintenance scripts.
  - Future "reset demo org" admin workflows.

  Scope:
  - Deletes ALL Site rows with Site.org_id == org_id.
  - For each site, deletes:
      - TimeseriesRecord rows with site_id in {"site-<id>", "<id>"}.
      - AlertEvent rows for those site_ids (and org_id if column exists).
      - SiteEvent rows for those site_ids (and org_id if column exists).
  - Relies on SQLAlchemy relationship cascades from Site to:
      - Sensors, Opportunities, Reports, etc. (where configured).

  Note:
  - This does NOT delete the Organization row itself.
  - This does NOT delete users or integration tokens; those are handled elsewhere.
  """

  logger.info("Starting org purge: org_id=%s", org_id)

  sites: Iterable[Site] = (
    db.query(Site)
    .filter(Site.org_id == org_id)
    .order_by(Site.id.asc())
    .all()
  )

  sites = list(sites)
  if not sites:
    logger.info("Org purge: no sites found for org_id=%s; nothing to do.", org_id)
    return {
      "org_id": org_id,
      "sites_deleted": 0,
      "timeseries_deleted": 0,
      "alert_events_deleted": 0,
      "site_events_deleted": 0,
    }

  total_ts = 0
  total_alerts = 0
  total_site_events = 0

  for site in sites:
    keys = _site_timeseries_keys(site.id)

    logger.info(
      "Org purge: cleaning site id=%s (org_id=%s, keys=%s)",
      site.id,
      org_id,
      sorted(keys),
    )

    # 1) Timeseries for this site's key space
    deleted_ts = (
      db.query(TimeseriesRecord)
      .filter(TimeseriesRecord.site_id.in_(keys))
      .delete(synchronize_session=False)
    )
    total_ts += deleted_ts

    # 2) Alert history/workflow rows for this site
    alert_q = db.query(AlertEvent).filter(AlertEvent.site_id.in_(keys))
    if hasattr(AlertEvent, "organization_id"):
      alert_q = alert_q.filter(AlertEvent.organization_id == org_id)
    deleted_alerts = alert_q.delete(synchronize_session=False)
    total_alerts += deleted_alerts

    # 3) Site timeline events for this site
    se_q = db.query(SiteEvent).filter(SiteEvent.site_id.in_(keys))
    if hasattr(SiteEvent, "organization_id"):
      se_q = se_q.filter(SiteEvent.organization_id == org_id)
    deleted_site_events = se_q.delete(synchronize_session=False)
    total_site_events += deleted_site_events

    # 4) Delete the Site row itself (relational cascades handle sensors/opps/reports)
    db.delete(site)

  sites_deleted = len(sites)
  db.commit()

  logger.info(
    "Org purge complete for org_id=%s: sites=%s, timeseries=%s, alert_events=%s, site_events=%s",
    org_id,
    sites_deleted,
    total_ts,
    total_alerts,
    total_site_events,
  )

  return {
    "org_id": org_id,
    "sites_deleted": sites_deleted,
    "timeseries_deleted": total_ts,
    "alert_events_deleted": total_alerts,
    "site_events_deleted": total_site_events,
  }
