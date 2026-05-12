# backend/app/api/v1/push.py
"""
Push Subscription Endpoints
----------------------------
POST   /push/subscribe          Register a device push subscription
DELETE /push/unsubscribe        Remove a push subscription
GET    /push/vapid-public-key   Return the VAPID public key for the browser
GET    /push/subscriptions      List active subscriptions for the current org
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import PushSubscription


logger = logging.getLogger("cei.push")

router = APIRouter(prefix="/push", tags=["push"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class PushSubscribeRequest(BaseModel):
    endpoint:     str
    p256dh:       str  # base64url encoded
    auth:         str  # base64url encoded
    device_label: Optional[str] = None


class PushSubscriptionOut(BaseModel):
    id:           int
    endpoint:     str
    device_label: Optional[str]
    is_active:    bool
    created_at:   str

    class Config:
        from_attributes = True


class VapidPublicKeyOut(BaseModel):
    public_key: str
    enabled:    bool


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get(
    "/vapid-public-key",
    response_model=VapidPublicKeyOut,
    status_code=status.HTTP_200_OK,
    summary="Get VAPID public key for browser push subscription",
)
def get_vapid_public_key() -> VapidPublicKeyOut:
    from app.core.config import settings as _settings
    return VapidPublicKeyOut(
        public_key=_settings.vapid_public_key or "",
        enabled=bool(_settings.vapid_private_key and _settings.vapid_public_key),
    )


@router.post(
    "/subscribe",
    response_model=PushSubscriptionOut,
    status_code=status.HTTP_200_OK,
    summary="Register a push subscription for the current device",
)
def subscribe(
    payload: PushSubscribeRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> PushSubscriptionOut:
    """
    Store a browser PushSubscription so CEI can send alert notifications.

    Idempotent: if the endpoint already exists for this org, it is
    reactivated and its keys updated (handles re-subscription after
    permission was revoked and re-granted).
    """
    from app.core.config import settings as _cfg
    if not (_cfg.vapid_private_key and _cfg.vapid_public_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured on this server.",
        )

    org_id: Optional[int] = getattr(user, "organization_id", None)
    user_id: Optional[int] = getattr(user, "id", None)

    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not associated with an organization.",
        )

    # Upsert — endpoint is globally unique per browser/device
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == payload.endpoint)
        .first()
    )

    if existing:
        existing.organization_id = org_id
        existing.user_id         = user_id
        existing.p256dh          = payload.p256dh
        existing.auth            = payload.auth
        existing.is_active       = True
        if payload.device_label:
            existing.device_label = payload.device_label
        db.commit()
        db.refresh(existing)
        sub = existing
    else:
        sub = PushSubscription(
            organization_id=org_id,
            user_id=user_id,
            endpoint=payload.endpoint,
            p256dh=payload.p256dh,
            auth=payload.auth,
            device_label=payload.device_label,
            is_active=True,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)

    logger.info(
        "Push subscription registered org_id=%s user_id=%s sub_id=%s",
        org_id, user_id, sub.id,
    )

    return PushSubscriptionOut(
        id=sub.id,
        endpoint=sub.endpoint,
        device_label=sub.device_label,
        is_active=sub.is_active,
        created_at=sub.created_at.isoformat(),
    )


@router.delete(
    "/unsubscribe",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove push subscription for the current device",
)
def unsubscribe(
    endpoint: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    """
    Deactivate a push subscription by endpoint URL.
    The record is soft-deleted (is_active = False) to preserve audit trail.
    """
    org_id: Optional[int] = getattr(user, "organization_id", None)

    q = db.query(PushSubscription).filter(
        PushSubscription.endpoint == endpoint,
        PushSubscription.is_active == True,
    )

    if org_id:
        q = q.filter(PushSubscription.organization_id == org_id)

    sub = q.first()
    if sub:
        sub.is_active = False
        db.commit()
        logger.info("Push subscription deactivated sub_id=%s", sub.id)


@router.get(
    "/subscriptions",
    response_model=List[PushSubscriptionOut],
    status_code=status.HTTP_200_OK,
    summary="List active push subscriptions for the current org",
)
def list_subscriptions(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[PushSubscriptionOut]:
    org_id: Optional[int] = getattr(user, "organization_id", None)
    if not org_id:
        return []

    rows = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.organization_id == org_id,
            PushSubscription.is_active == True,
        )
        .order_by(PushSubscription.created_at.desc())
        .all()
    )

    return [
        PushSubscriptionOut(
            id=r.id,
            endpoint=r.endpoint,
            device_label=r.device_label,
            is_active=r.is_active,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]