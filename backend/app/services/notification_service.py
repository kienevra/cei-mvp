# backend/app/services/notification_service.py
"""
Notification service.
Best-effort: never raises — notification failure must never break the caller.

Usage:
    from app.services.notification_service import notify

    notify(db, org_id=2, type=NotifType.LINK_REQUEST_RECEIVED,
           title="GreenEnergy vuole gestire il tuo account",
           body="Hai ricevuto una richiesta di collegamento.",
           extra={"managing_org_name": "GreenEnergy Consulting"})
    db.commit()  # caller commits; notify() only adds to session
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger("cei.notifications")


# ── Notification type constants ───────────────────────────────────────────────

class NotifType:
    # Link requests
    LINK_REQUEST_RECEIVED  = "link_request_received"   # org receives from consultant
    LINK_REQUEST_ACCEPTED  = "link_request_accepted"   # consultant learns org accepted
    LINK_REQUEST_REJECTED  = "link_request_rejected"   # consultant learns org rejected
    LINK_REQUEST_CANCELLED = "link_request_cancelled"  # org learns consultant cancelled

    # Org relationship changes
    ORG_LINKED   = "org_linked"    # org is now managed
    ORG_UNLINKED = "org_unlinked"  # org left or was removed

    # Alerts
    ALERT_CRITICAL = "alert_critical"
    ALERT_WARNING  = "alert_warning"

    # Team / invites
    INVITE_RECEIVED    = "invite_received"     # user/org got an invite
    TEAM_MEMBER_JOINED = "team_member_joined"  # someone accepted an invite

    # Integrations / health
    INGEST_HEALTH_DEGRADED = "ingest_health_degraded"  # site went silent
    TOKEN_FIRST_USE        = "token_first_use"          # integration token first use


def notify(
    db: Session,
    org_id: int,
    type: str,
    title: str,
    body: Optional[str] = None,
    user_id: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Add a Notification row to the session.
    Caller is responsible for committing.
    Never raises — logs on failure instead.
    """
    try:
        from app.models import Notification  # late import to avoid circular deps

        n = Notification(
            org_id=org_id,
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            is_read=False,
            extra=extra or {},
        )
        db.add(n)
    except Exception:
        logger.exception(
            "notify() failed — org_id=%s type=%s title=%r",
            org_id, type, title,
        )


def notify_both(
    db: Session,
    org_id_a: int,
    org_id_b: int,
    type: str,
    title: str,
    body: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Convenience: send the same notification to two orgs."""
    notify(db, org_id_a, type, title, body, extra=extra)
    notify(db, org_id_b, type, title, body, extra=extra)