# backend/app/services/push_notifications.py
"""
Push Notifications Service
--------------------------
Sends Web Push notifications to subscribed devices via VAPID.

Only fires for severity == "warning" or "critical" alerts.
All calls are best-effort — a push failure never blocks alert persistence.

Requires in backend/.env:
  VAPID_PRIVATE_KEY   base64url raw private key (from generate_vapid_env.py)
  VAPID_PUBLIC_KEY    base64url uncompressed EC point (for browser)
  VAPID_CLAIMS_EMAIL  e.g. support@carbonefficiencyintel.com
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

logger = logging.getLogger("cei.push")

# ── VAPID config (read once at import time) ───────────────────────────────────

from app.core.config import settings as _settings

VAPID_PRIVATE_KEY: Optional[str] = _settings.vapid_private_key
VAPID_PUBLIC_KEY:  Optional[str] = _settings.vapid_public_key
VAPID_EMAIL:       str           = _settings.vapid_claims_email

PUSH_ENABLED = bool(VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY)

if not PUSH_ENABLED:
    logger.warning(
        "VAPID_PRIVATE_KEY or VAPID_PUBLIC_KEY not set — push notifications disabled. "
        "Run generate_vapid_env.py and add keys to backend/.env to enable."
    )

# ── Severity config ───────────────────────────────────────────────────────────

SEVERITY_ICON = {
    "critical": "🔴",
    "warning":  "⚠️",
    "info":     "ℹ️",
}

PUSH_SEVERITIES = {"warning", "critical"}  # info alerts do NOT trigger push


# ── Core send function ────────────────────────────────────────────────────────

def send_push_to_org(
    db: Session,
    org_id: int,
    title: str,
    body: str,
    url: str = "/alerts",
    tag: Optional[str] = None,
    severity: str = "warning",
) -> int:
    """
    Send a push notification to all active subscriptions for an org.

    Returns the number of successful sends.
    Stale/expired subscriptions (HTTP 404/410) are automatically deactivated.
    """
    if not PUSH_ENABLED:
        return 0

    if severity not in PUSH_SEVERITIES:
        return 0

    # Lazy import to avoid circular imports at module load
    from app.models import PushSubscription

    try:
        subscriptions = (
            db.query(PushSubscription)
            .filter(
                PushSubscription.organization_id == org_id,
                PushSubscription.is_active == True,
            )
            .all()
        )
    except Exception:
        logger.exception("Failed to load push subscriptions for org_id=%s", org_id)
        return 0

    if not subscriptions:
        return 0

    payload = json.dumps({
        "title": title,
        "body":  body,
        "url":   url,
        "tag":   tag or f"cei-{severity}",
        "severity": severity,
        "timestamp": __import__("time").time(),
    })

    sent = 0
    stale_ids = []

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {
                        "p256dh": sub.p256dh,
                        "auth":   sub.auth,
                    },
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={
                    "sub": f"mailto:{VAPID_EMAIL}",
                },
                ttl=3600,  # notification valid for 1h if device is offline
            )
            sent += 1
            logger.debug("Push sent to sub_id=%s org_id=%s", sub.id, org_id)

        except WebPushException as exc:
            resp = exc.response
            if resp is not None and resp.status_code in (404, 410):
                # Subscription expired or unsubscribed — mark stale
                logger.info(
                    "Push subscription stale (HTTP %s), deactivating sub_id=%s",
                    resp.status_code, sub.id,
                )
                stale_ids.append(sub.id)
            else:
                logger.warning(
                    "Push failed for sub_id=%s: %s", sub.id, exc
                )
        except Exception:
            logger.exception("Unexpected push error for sub_id=%s", sub.id)

    # Deactivate stale subscriptions
    if stale_ids:
        try:
            from app.models import PushSubscription as PS
            db.query(PS).filter(PS.id.in_(stale_ids)).update(
                {"is_active": False}, synchronize_session=False
            )
            db.commit()
        except Exception:
            logger.exception("Failed to deactivate stale subscriptions")

    return sent


def send_alert_push(
    db: Session,
    org_id: int,
    severity: str,
    title: str,
    message: str,
    site_name: Optional[str],
    metric: Optional[str],
    site_id: Optional[str],
) -> None:
    """
    Convenience wrapper called from _persist_alert_events in alerts.py.

    Only fires for warning and critical. Truncates message for banner display.
    """
    if severity not in PUSH_SEVERITIES:
        return

    icon = SEVERITY_ICON.get(severity, "⚠️")
    push_title = f"{icon} {title}"

    # Body: "Plant A · Elevated night-time baseline..."
    prefix = f"{site_name} · " if site_name else ""
    max_body = 100
    body_text = message[:max_body] + ("…" if len(message) > max_body else "")
    push_body = f"{prefix}{body_text}"

    # Unique tag per (rule, site) — browser updates existing notification
    # instead of stacking duplicates
    tag = f"cei-{metric or severity}-{site_id or 'portfolio'}"

    try:
        send_push_to_org(
            db=db,
            org_id=org_id,
            title=push_title,
            body=push_body,
            url="/alerts",
            tag=tag,
            severity=severity,
        )
    except Exception:
        logger.exception(
            "send_alert_push failed org_id=%s metric=%s", org_id, metric
        )