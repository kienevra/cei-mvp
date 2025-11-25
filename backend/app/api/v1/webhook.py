# backend/app/api/v1/webhook.py
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.services.stripe_billing import get_stripe_config

logger = logging.getLogger("cei")

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

try:
    import stripe  # type: ignore
except ImportError:
    stripe = None  # type: ignore


@router.post("/stripe", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
    stripe_signature: Optional[str] = Header(None, alias="Stripe-Signature"),
) -> Dict[str, Any]:
    """
    Stripe webhook endpoint.

    Expected to be configured in Stripe dashboard with:
      - endpoint URL:   https://<your-api>/api/v1/webhooks/stripe
      - signing secret: STRIPE_WEBHOOK_SECRET / settings.stripe_webhook_secret
    """
    cfg = get_stripe_config()
    if not cfg.enabled or not cfg.webhook_secret:
        logger.warning("Stripe webhook called but Stripe not configured; ignoring.")
        return {"received": True, "ignored": "stripe_not_configured"}

    if stripe is None:
        logger.error("Stripe SDK not installed but webhook hit.")
        raise HTTPException(
            status_code=500,
            detail="Stripe SDK not installed on server.",
        )

    payload = await request.body()
    sig_header = stripe_signature or ""

    try:
        event = stripe.Webhook.construct_event(  # type: ignore[attr-defined]
            payload=payload,
            sig_header=sig_header,
            secret=cfg.webhook_secret,
        )
    except ValueError:
        # Invalid payload
        logger.exception("Invalid Stripe webhook payload.")
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:  # type: ignore[attr-defined]
        logger.exception("Invalid Stripe webhook signature.")
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type: str = event["type"]
    obj = event["data"]["object"]

    logger.info("Stripe webhook event received: %s", event_type)

    if event_type == "checkout.session.completed":
        _handle_checkout_session_completed(db, obj)
    elif event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
    ):
        _handle_subscription_upsert(db, obj)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(db, obj)
    else:
        logger.debug("Stripe webhook event type %s not explicitly handled.", event_type)

    # Stripe expects 2xx to consider it delivered successfully
    return {"received": True}


# ===== Handlers =====


def _handle_checkout_session_completed(db: Session, session_obj: Dict[str, Any]) -> None:
    """
    When checkout completes, we:
      - read `metadata.cei_org_id` and `metadata.cei_plan_key`
      - update Organization.stripe_status (e.g. 'active')
      - persist stripe_subscription_id if we can find one
      - optionally create/update Subscription row
    """
    try:
        from app.models import Organization, Subscription, BillingPlan  # type: ignore[attr-defined]
    except Exception:
        logger.exception("Billing models not available; cannot hydrate checkout.session.completed.")
        return

    metadata = session_obj.get("metadata") or {}
    org_id_raw = metadata.get("cei_org_id") or ""
    plan_key = metadata.get("cei_plan_key")

    if not org_id_raw:
        logger.warning("Stripe checkout.session.completed without cei_org_id metadata.")
        return

    try:
        org_id = int(org_id_raw)
    except ValueError:
        logger.warning("Invalid cei_org_id '%s' in metadata.", org_id_raw)
        return

    org: Optional[Organization] = db.query(Organization).get(org_id)
    if not org:
        logger.warning("No Organization found for id=%s during checkout completion.", org_id)
        return

    subscription_id = session_obj.get("subscription")

    # Update org stripe_status + identifiers if those fields exist
    if hasattr(org, "stripe_status"):
        setattr(org, "stripe_status", "active")
    if subscription_id and hasattr(org, "stripe_subscription_id"):
        setattr(org, "stripe_subscription_id", subscription_id)

    # Try to wire up a Subscription row if the model is present
    try:
        plan_obj = None
        if plan_key and hasattr(BillingPlan, "key"):
            plan_obj = (
                db.query(BillingPlan)
                .filter(BillingPlan.key == plan_key)
                .first()
            )

        sub = (
            db.query(Subscription)
            .filter(
                Subscription.org_id == org_id,
                Subscription.stripe_subscription_id == subscription_id,
            )
            .first()
            if subscription_id
            else None
        )

        if not sub:
            sub = Subscription()
            if hasattr(sub, "org_id"):
                setattr(sub, "org_id", org_id)
            if subscription_id and hasattr(sub, "stripe_subscription_id"):
                setattr(sub, "stripe_subscription_id", subscription_id)

        if plan_obj and hasattr(sub, "plan_id"):
            setattr(sub, "plan_id", plan_obj.id)
        if hasattr(sub, "status"):
            setattr(sub, "status", "active")
        if hasattr(sub, "is_active"):
            setattr(sub, "is_active", True)

        db.add(sub)
    except Exception:
        logger.exception("Failed to upsert Subscription on checkout.session.completed.")

    db.add(org)
    try:
        db.commit()
    except Exception:
        logger.exception("Failed to commit Stripe checkout updates.")
        db.rollback()


def _handle_subscription_upsert(db: Session, sub_obj: Dict[str, Any]) -> None:
    """
    customer.subscription.created / updated

    Keep Organization.stripe_status + Subscription row in sync.
    """
    try:
        from app.models import Organization, Subscription, BillingPlan  # type: ignore[attr-defined]
    except Exception:
        logger.exception("Billing models not available; cannot process subscription upsert.")
        return

    subscription_id = sub_obj.get("id")
    customer_id = sub_obj.get("customer")
    status_val = sub_obj.get("status")  # trialing, active, past_due, canceled, etc.
    metadata = sub_obj.get("metadata") or {}
    plan_key = metadata.get("cei_plan_key")

    # Find org by stripe_customer_id
    org: Optional[Organization] = (
        db.query(Organization)
        .filter(getattr(Organization, "stripe_customer_id") == customer_id)  # type: ignore[attr-defined]
        .first()
        if hasattr(Organization, "stripe_customer_id")
        else None
    )

    if not org:
        logger.warning(
            "Stripe subscription upsert but no Organization linked to customer_id=%s",
            customer_id,
        )
        return

    org_id = getattr(org, "id", None)

    # Update org stripe_status / subscription id if fields exist
    if hasattr(org, "stripe_status") and status_val:
        setattr(org, "stripe_status", status_val)
    if hasattr(org, "stripe_subscription_id") and subscription_id:
        setattr(org, "stripe_subscription_id", subscription_id)

    # Upsert Subscription row
    try:
        sub = (
            db.query(Subscription)
            .filter(Subscription.org_id == org_id, Subscription.stripe_subscription_id == subscription_id)
            .first()
            if subscription_id
            else None
        )

        if not sub:
            sub = Subscription()
            if hasattr(sub, "org_id"):
                setattr(sub, "org_id", org_id)
            if subscription_id and hasattr(sub, "stripe_subscription_id"):
                setattr(sub, "stripe_subscription_id", subscription_id)

        if hasattr(sub, "status") and status_val:
            setattr(sub, "status", status_val)
        if hasattr(sub, "is_active"):
            setattr(sub, "is_active", status_val in ("trialing", "active"))

        # Wire to BillingPlan if we have a plan_key and a key column
        if plan_key and hasattr(BillingPlan, "key") and hasattr(sub, "plan_id"):
            plan_obj = (
                db.query(BillingPlan)
                .filter(BillingPlan.key == plan_key)
                .first()
            )
            if plan_obj:
                setattr(sub, "plan_id", plan_obj.id)

        db.add(sub)
    except Exception:
        logger.exception("Failed to upsert Subscription for org %s", org_id)

    db.add(org)
    try:
        db.commit()
    except Exception:
        logger.exception("Failed to commit subscription upsert.")
        db.rollback()


def _handle_subscription_deleted(db: Session, sub_obj: Dict[str, Any]) -> None:
    """
    customer.subscription.deleted

    Mark Subscription + Organization as canceled/inactive, if models support it.
    """
    try:
        from app.models import Organization, Subscription  # type: ignore[attr-defined]
    except Exception:
        logger.exception("Billing models not available; cannot process subscription deleted.")
        return

    subscription_id = sub_obj.get("id")
    customer_id = sub_obj.get("customer")

    if not subscription_id:
        logger.warning("subscription.deleted without id; ignoring.")
        return

    # Find org by stripe_customer_id
    org: Optional[Organization] = (
        db.query(Organization)
        .filter(getattr(Organization, "stripe_customer_id") == customer_id)  # type: ignore[attr-defined]
        .first()
        if hasattr(Organization, "stripe_customer_id")
        else None
    )

    sub: Optional[Subscription] = (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id == subscription_id)
        .first()
        if hasattr(Subscription, "stripe_subscription_id")
        else None
    )

    if org and hasattr(org, "stripe_status"):
        setattr(org, "stripe_status", "canceled")

    if sub:
        if hasattr(sub, "status"):
            setattr(sub, "status", "canceled")
        if hasattr(sub, "is_active"):
            setattr(sub, "is_active", False)
        db.add(sub)

    if org:
        db.add(org)

    try:
        db.commit()
    except Exception:
        logger.exception("Failed to commit subscription deleted.")
        db.rollback()
