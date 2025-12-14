# backend/app/db/models.py
"""
Compatibility shim for legacy imports.

Historically, some parts of the codebase imported models via:
    from app.db import models
    models.Organization
    models.IntegrationToken
    ...

The canonical, full model definitions now live in `app/models.py`.
This module simply re-exports those classes so existing imports keep
working, without redefining any tables or causing SQLAlchemy metadata
conflicts.
"""

from app.models import (
    Organization,
    User,
    BillingPlan,
    Subscription,
    Site,
    Sensor,
    Opportunity,
    Report,
    Metric,
    TimeseriesRecord,
    StagingUpload,
    AlertEvent,
    SiteEvent,
    IntegrationToken,
    OrgInvite,
)

__all__ = [
    "Organization",
    "User",
    "BillingPlan",
    "Subscription",
    "Site",
    "Sensor",
    "Opportunity",
    "Report",
    "Metric",
    "TimeseriesRecord",
    "StagingUpload",
    "AlertEvent",
    "SiteEvent",
    "IntegrationToken",
    "OrgInvite",
]
