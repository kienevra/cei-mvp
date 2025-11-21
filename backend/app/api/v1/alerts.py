# backend/app/api/v1/alerts.py
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import Site, TimeseriesRecord, User

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertOut(BaseModel):
    id: str
    site_id: Optional[int]
    site_name: Optional[str]
    severity: str  # "critical" | "warning" | "info" (MVP)
    title: str
    summary: str
    created_at: datetime
    status: str  # "open" for now

    class Config:
        from_attributes = True  # pydantic v2 style


@router.get("/", response_model=List[AlertOut])
def list_virtual_alerts(
    window_hours: int = Query(
        24,
        ge=1,
        le=24 * 14,
        description="Lookback window for computing alerts (hours).",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[AlertOut]:
    """
    Virtual alerts computed on the fly from timeseries data.

    Heuristics (MVP):
    - No data for a site in the last N hours -> info alert.
    - High energy (kWh) in window -> elevated / critical usage alerts.
    - Very low load factor (avg/peak) -> peaky load profile warning.

    NOTE: This does NOT persist alerts yet; it's a read-only “inbox”
    derived from live data.
    """
    now = datetime.utcnow()
    window_start = now - timedelta(hours=window_hours)

    # Scope to the user's org if present; otherwise, return all sites.
    site_query = db.query(Site)
    if getattr(current_user, "organization_id", None) is not None:
        site_query = site_query.filter(
            Site.organization_id == current_user.organization_id
        )

    sites = site_query.all()

    alerts: List[AlertOut] = []

    for site in sites:
        site_name = site.name or f"Site {site.id}"
        site_key = f"site-{site.id}"  # aligns with frontend timeseries filters

        # Aggregate basic metrics for this site in the window
        count, total_value, max_value = (
            db.query(
                func.count(TimeseriesRecord.id),
                func.coalesce(func.sum(TimeseriesRecord.value), 0.0),
                func.coalesce(func.max(TimeseriesRecord.value), 0.0),
            )
            .filter(
                TimeseriesRecord.site_id == site_key,
                TimeseriesRecord.timestamp >= window_start,
                TimeseriesRecord.timestamp <= now,
            )
            .one()
        )

        # 1) No data -> info alert
        if count == 0:
            alerts.append(
                AlertOut(
                    id=f"{site.id}-no-data",
                    site_id=site.id,
                    site_name=site_name,
                    severity="info",
                    title=f"No recent data for {site_name}",
                    summary=(
                        f"CEI has not seen any readings tagged site_id = '{site_key}' "
                        f"in the last {window_hours} hours. "
                        "Check your CSV uploads or data pipeline for this site."
                    ),
                    created_at=now,
                    status="open",
                )
            )
            continue

        # Basic kWh / load factor heuristics
        hours = float(window_hours)
        energy_kwh = float(total_value)
        avg_kw = energy_kwh / hours if hours > 0 else 0.0
        peak_kw = float(max_value) if max_value is not None else 0.0
        load_factor = (avg_kw / peak_kw) if peak_kw > 0 else None

        # 2) High usage alerts
        if energy_kwh > 1500:
            alerts.append(
                AlertOut(
                    id=f"{site.id}-high-usage",
                    site_id=site.id,
                    site_name=site_name,
                    severity="critical",
                    title=f"{site_name} is running very energy-intensive",
                    summary=(
                        f"In the last {window_hours} hours, this site used "
                        f"~{energy_kwh:.0f} kWh. "
                        "That’s high for a single site. Review peak hours and off-shift load "
                        "to find quick wins on baseload and scheduling."
                    ),
                    created_at=now,
                    status="open",
                )
            )
        elif energy_kwh > 800:
            alerts.append(
                AlertOut(
                    id=f"{site.id}-elevated-usage",
                    site_id=site.id,
                    site_name=site_name,
                    severity="warning",
                    title=f"Elevated energy use at {site_name}",
                    summary=(
                        f"Energy over the last {window_hours} hours is "
                        f"~{energy_kwh:.0f} kWh. "
                        "Consider staggering batches, tightening shutdown procedures, "
                        "and reviewing night/weekend profiles."
                    ),
                    created_at=now,
                    status="open",
                )
            )

        # 3) Peaky load profile -> warning
        if load_factor is not None and load_factor < 0.30 and peak_kw > 0:
            alerts.append(
                AlertOut(
                    id=f"{site.id}-peaky-load",
                    site_id=site.id,
                    site_name=site_name,
                    severity="warning",
                    title=f"Peaky load profile at {site_name}",
                    summary=(
                        f"Load factor is {load_factor:.2f} (avg ~{avg_kw:.1f} kW vs peak "
                        f"~{peak_kw:.1f} kW). This usually indicates short, sharp peaks "
                        "that drive demand charges. Focus on peak shaving and staggering starts."
                    ),
                    created_at=now,
                    status="open",
                )
            )

        # 4) “Steady baseline” info – good target for baseload optimisation
        if (
            energy_kwh > 0
            and energy_kwh <= 800
            and load_factor is not None
            and load_factor >= 0.70
        ):
            alerts.append(
                AlertOut(
                    id=f"{site.id}-steady-baseline",
                    site_id=site.id,
                    site_name=site_name,
                    severity="info",
                    title=f"Steady baseline at {site_name}",
                    summary=(
                        f"{site_name} has a relatively flat profile (load factor "
                        f"{load_factor:.2f}). Good candidate for identifying constant "
                        "loads that can be reduced or shifted off-peak."
                    ),
                    created_at=now,
                    status="open",
                )
            )

    # Sort: critical → warning → info, then newest first
    severity_rank = {"critical": 0, "warning": 1, "info": 2}

    alerts.sort(
        key=lambda a: (
            severity_rank.get(a.severity, 99),
            a.created_at,
        ),
        reverse=True,
    )

    return alerts
