# backend/app/api/v1/notifications.py
"""
Notifications API
-----------------
GET  /notifications          — list recent (last 50) for current org
GET  /notifications/count    — unread count only (for bell badge polling)
POST /notifications/read-all — mark all as read
POST /notifications/{id}/read — mark one as read
DELETE /notifications/{id}   — dismiss a notification
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import Notification

logger = logging.getLogger("cei.notifications")

router = APIRouter(tags=["notifications"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id:         int
    type:       str
    title:      str
    body:       Optional[str]
    is_read:    bool
    extra:      Optional[Dict[str, Any]]
    created_at: str


class UnreadCountOut(BaseModel):
    unread: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _notif_out(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        is_read=bool(n.is_read),
        extra=n.extra or {},
        created_at=n.created_at.isoformat() if n.created_at else "",
    )


def _get_org_id(user) -> int:
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        raise HTTPException(status_code=403, detail="No organization attached to this account.")
    return int(org_id)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get(
    "/notifications",
    response_model=List[NotificationOut],
    summary="List recent notifications for the current org",
)
def list_notifications(
    limit: int = 50,
    unread_only: bool = False,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[NotificationOut]:
    org_id = _get_org_id(user)

    q = db.query(Notification).filter(Notification.org_id == org_id)
    if unread_only:
        q = q.filter(Notification.is_read == False)  # noqa: E712

    rows = q.order_by(Notification.created_at.desc()).limit(limit).all()
    return [_notif_out(n) for n in rows]


@router.get(
    "/notifications/count",
    response_model=UnreadCountOut,
    summary="Get unread notification count for bell badge",
)
def get_unread_count(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> UnreadCountOut:
    org_id = _get_org_id(user)
    count = (
        db.query(Notification)
        .filter(
            Notification.org_id == org_id,
            Notification.is_read == False,  # noqa: E712
        )
        .count()
    )
    return UnreadCountOut(unread=count)


@router.post(
    "/notifications/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark all notifications as read",
)
def mark_all_read(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    org_id = _get_org_id(user)
    db.query(Notification).filter(
        Notification.org_id == org_id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()


@router.post(
    "/notifications/{notification_id}/read",
    response_model=NotificationOut,
    summary="Mark a single notification as read",
)
def mark_one_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> NotificationOut:
    org_id = _get_org_id(user)
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.org_id == org_id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    n.is_read = True
    db.commit()
    db.refresh(n)
    return _notif_out(n)


@router.delete(
    "/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Dismiss (delete) a notification",
)
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    org_id = _get_org_id(user)
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.org_id == org_id,
    ).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found.")
    db.delete(n)
    db.commit()