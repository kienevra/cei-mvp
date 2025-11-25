# backend/app/api/v1/stripe_webhook.py
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Organization  # type: ignore
from app.services.stripe_billing import (
    PLAN_TO_STRIPE_PRICE,
    get_stripe_config,
)

logger = logging.getLogger("cei")

router = APIRouter(prefix="/stripe", tags=["billing"])

try:
    import stripe  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    stripe = None  # type: ignore


class WebhookAck(BaseModel):
    received: bool = True


@dataclass
class OrgPlanUpdate:
    """
    What we care about when Stripe tells us something changed.
    """
    plan_key: Optional[str]
    status: Optional[str]
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]


# ====== Core webhook entrypoint ======


@router.post("/webhook", response_model=WebhookAck)
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
) -> WebhookAck:
    """
    Stripe webhook endpoint.

    Responsibilities:
      - Verify Stripe signature using STRIPE_WEBHOOK_SECRET.
      - Handle a small set of events:
          * checkout.session.completed
          * customer.subscription.created / updated / deleted
      - Map events back to an Organization and update:
          * subscription_plan_key
          * subscription_status
          * enable_alerts / enable_reports (and enable_insights if present)
          * stripe_customer_id / stripe_subscription_id / stripe_status
    """
    cfg = get_stripe_config()
    if not cfg.webhook_secret:
        logger.warning(
            "Stripe webhook hit but STRIPE_WEBHOOK_SECRET is not configured; "
            "ignoring request."
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe webhook not configured on this deployment.",
        )

    if stripe is None:
        logger.error(
            "Stripe webhook received but 'stripe' SDK is not installed. "
            "Install the 'stripe' package to process webhooks."
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe SDK not installed.",
        )

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Stripe-Signature header.",
        )

    try:
        event = stripe.Webhook.construct_event(  # type: ignore[attr-defined]
            payload=payload,
            sig_header=sig_header,
            secret=cfg.webhook_secret,
        )
    except ValueError:
        logger.warning("Invalid Stripe webhook payload.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payload.",
        )
    except stripe.error.SignatureVerificationError:  # type: ignore[attr-defined]
        logger.warning("Invalid Stripe webhook signature.")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid signature.",
        )

    event_type: str = event.get("type", "")
    data_object: Dict[str, Any] = event.get("data", {}).get("object", {}) or {}

    logger.info("Received Stripe event type=%s", event_type)

    # Route to specific handlers
    if event_type == "checkout.session.completed":
        _handle_checkout_completed(db, data_object)
    elif event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        _handle_subscription_event(db, event_type, data_object)
    else:
        # For now we ignore all other event types.
        logger.info("Ignoring unsupported Stripe event type: %s", event_type)

    return WebhookAck(received=True)


# ====== Event handlers ======


def _handle_checkout_completed(db: Session, session_obj: Dict[str, Any]) -> None:
    """
    When a Checkout session completes, we know:
      - which org (via metadata.cei_org_id)
      - what logical CEI plan (via metadata.cei_plan_key)
      - the Stripe customer + subscription IDs.

    We use this to:
      - attach stripe_customer_id and stripe_subscription_id to the org
      - set subscription_plan_key / subscription_status
      - flip feature flags (enable_alerts / enable_reports / enable_insights)
    """
    metadata = session_obj.get("metadata", {}) or {}
    org_id_raw = metadata.get("cei_org_id")
    plan_key = metadata.get("cei_plan_key")

    if not org_id_raw:
        logger.warning(
            "checkout.session.completed without cei_org_id metadata; "
            "cannot map to Organization."
        )
        return

    try:
        org_id = int(org_id_raw)
    except (TypeError, ValueError):
        logger.warning(
            "checkout.session.completed had non-integer cei_org_id=%r; ignoring.",
            org_id_raw,
        )
        return

    org: Optional[Organization] = db.get(Organization, org_id)
    if not org:
        logger.warning(
            "checkout.session.completed for unknown Organization id=%s; ignoring.",
            org_id,
        )
        return

    stripe_customer_id = session_obj.get("customer")
    stripe_subscription_id = session_obj.get("subscription")
    status = "active"  # optimistic default; subscription webhooks will refine

    update = OrgPlanUpdate(
        plan_key=plan_key,
        status=status,
        stripe_customer_id=stripe_customer_id,
        stripe_subscription_id=stripe_subscription_id,
    )

    _apply_org_plan_update(db, org, update)


def _handle_subscription_event(
    db: Session,
    event_type: str,
    subscription_obj: Dict[str, Any],
) -> None:
    """
    Handle customer.subscription.* webhooks.

    We locate the Organization via stripe_customer_id and then update:
      - subscription_plan_key (from metadata or price mapping)
      - subscription_status
      - stripe_subscription_id
      - feature flags (enable_*).
    """
    customer_id = subscription_obj.get("customer")
    if not customer_id:
        logger.warning(
            "%s event without customer id; ignoring.",
            event_type,
        )
        return

    # Locate org by stripe_customer_id
    try:
        org: Optional[Organization] = (
            db.query(Organization)  # type: ignore[attr-defined]
            .filter(getattr(Organization, "stripe_customer_id") == customer_id)
            .first()
        )
    except Exception as e:
        logger.exception(
            "Error querying Organization by stripe_customer_id=%s: %s",
            customer_id,
            e,
        )
        return

    if not org:
        logger.warning(
            "%s for unknown stripe_customer_id=%s; ignoring.",
            event_type,
            customer_id,
        )
        return

    # Plan key: prefer metadata, fall back to price ID mapping
    metadata = subscription_obj.get("metadata", {}) or {}
    plan_key = metadata.get("cei_plan_key")

    if not plan_key:
        plan_key = _plan_key_from_subscription_items(subscription_obj)

    status = subscription_obj.get("status")  # active / trialing / canceled / etc.
    stripe_subscription_id = subscription_obj.get("id")

    update = OrgPlanUpdate(
        plan_key=plan_key,
        status=status,
        stripe_customer_id=customer_id,
        stripe_subscription_id=stripe_subscription_id,
    )

    _apply_org_plan_update(db, org, update)


# ====== Helpers ======


def _plan_key_from_subscription_items(subscription_obj: Dict[str, Any]) -> Optional[str]:
    """
    Try to infer CEI plan key from the first subscription item price.id,
    using PLAN_TO_STRIPE_PRICE as the source of truth.
    """
    items = subscription_obj.get("items", {}) or {}
    data = items.get("data") or []
    if not data:
        return None

    first_item = data[0]
    price = first_item.get("price", {}) or {}
    price_id = price.get("id")
    if not price_id:
        return None

    # Reverse lookup
    for key, mapped_price_id in PLAN_TO_STRIPE_PRICE.items():
        if mapped_price_id == price_id:
            return key
    return None


def _apply_org_plan_update(
    db: Session,
    org: Organization,
    update: OrgPlanUpdate,
) -> None:
    """
    Central place to:
      - set subscription_plan_key and subscription_status
      - persist Stripe identifiers
      - flip feature flags (alerts / reports / insights) based on status
    """
    org_id = getattr(org, "id", None)

    # Stripe identifiers
    if hasattr(org, "stripe_customer_id") and update.stripe_customer_id:
        setattr(org, "stripe_customer_id", update.stripe_customer_id)

    if hasattr(org, "stripe_subscription_id") and update.stripe_subscription_id:
        setattr(org, "stripe_subscription_id", update.stripe_subscription_id)

    # Plan + status
    if hasattr(org, "subscription_plan_key") and update.plan_key is not None:
        setattr(org, "subscription_plan_key", update.plan_key)

    if hasattr(org, "subscription_status") and update.status is not None:
        setattr(org, "subscription_status", update.status)

    # High-level "stripe_status" mirror if present
    if hasattr(org, "stripe_status") and update.status is not None:
        setattr(org, "stripe_status", update.status)

    # Feature gating – align with /auth/me, Alerts, Reports
    # Treat active/trialing as "on", everything else as "off".
    active = update.status in ("active", "trialing")
    has_plan = bool(update.plan_key)

    enable_features = bool(active and has_plan)

    if hasattr(org, "enable_alerts"):
        setattr(org, "enable_alerts", enable_features)
    if hasattr(org, "enable_reports"):
        setattr(org, "enable_reports", enable_features)
    if hasattr(org, "enable_insights"):
        setattr(org, "enable_insights", enable_features)

    try:
        db.add(org)
        db.commit()
        logger.info(
            "Updated org %s from Stripe webhook: plan=%s, status=%s, "
            "alerts=%s, reports=%s",
            org_id,
            getattr(org, "subscription_plan_key", None),
            getattr(org, "subscription_status", None),
            getattr(org, "enable_alerts", None),
            getattr(org, "enable_reports", None),
        )
    except Exception as e:
        db.rollback()
        logger.exception(
            "Failed to persist Stripe plan update for org %s: %s",
            org_id,
            e,
        )
