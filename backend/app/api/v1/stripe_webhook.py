# backend/app/api/v1/stripe_webhook.py
"""
Stripe webhook handler — hardened (Phase 5 / billing hardening).

Events handled:
  checkout.session.completed              → attach customer/subscription, activate plan
  customer.subscription.created          → activate plan
  customer.subscription.updated          → update plan / status
  customer.subscription.deleted          → cancel plan, disable features
  customer.subscription.paused           → pause plan, disable features
  invoice.paid                           → payment recovered → flip back to active
  invoice.payment_failed                 → flip to past_due, disable features
  invoice.payment_action_required        → flip to past_due, disable features

Managing org cascade:
  When a managing org's subscription goes inactive (past_due / canceled / paused /
  unpaid), all of its client orgs have their feature flags disabled too.
  When it recovers (active / trialing), client orgs are re-enabled.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Organization
from app.services.stripe_billing import (
    PLAN_TO_STRIPE_PRICE,
    get_stripe_config,
)

logger = logging.getLogger("cei")

router = APIRouter(prefix="/stripe", tags=["billing"])

try:
    import stripe  # type: ignore
except ImportError:
    stripe = None  # type: ignore

# Subscription statuses that mean "paying and allowed to use features"
ACTIVE_STATUSES = {"active", "trialing"}

# Statuses that mean "payment problem — disable features but keep data"
DEGRADED_STATUSES = {"past_due", "unpaid", "paused"}

# Statuses that mean "fully canceled"
CANCELED_STATUSES = {"canceled"}


class WebhookAck(BaseModel):
    received: bool = True


@dataclass
class OrgPlanUpdate:
    """What we care about when Stripe tells us something changed."""
    plan_key: Optional[str]
    status: Optional[str]
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]


# ---------------------------------------------------------------------------
# Webhook entrypoint
# ---------------------------------------------------------------------------

@router.post("/webhook", response_model=WebhookAck)
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
) -> WebhookAck:
    """
    Stripe webhook endpoint.

    Verifies the Stripe signature then routes to the appropriate handler.
    Always returns 200 WebhookAck so Stripe doesn't retry on logic errors —
    retries are only appropriate for genuine infrastructure failures.
    """
    cfg = get_stripe_config()
    if not cfg.webhook_secret:
        logger.warning(
            "Stripe webhook hit but STRIPE_WEBHOOK_SECRET is not configured; ignoring."
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stripe webhook not configured on this deployment.",
        )

    if stripe is None:
        logger.error(
            "Stripe webhook received but 'stripe' SDK is not installed."
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
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=cfg.webhook_secret,
        )
    except ValueError:
        logger.warning("Invalid Stripe webhook payload.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload.")
    except stripe.error.SignatureVerificationError:
        logger.warning("Invalid Stripe webhook signature.")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature.")

    event_type: str = event.get("type", "")
    data_object: Dict[str, Any] = event.get("data", {}).get("object", {}) or {}

    logger.info("Received Stripe event type=%s id=%s", event_type, event.get("id"))

    try:
        _route_event(db, event_type, data_object)
    except Exception:
        # Log but never raise — Stripe should not retry on our logic errors
        logger.exception(
            "Unhandled exception processing Stripe event type=%s id=%s",
            event_type,
            event.get("id"),
        )

    return WebhookAck(received=True)


def _route_event(db: Session, event_type: str, data_object: Dict[str, Any]) -> None:
    """Route a verified Stripe event to the appropriate handler."""

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(db, data_object)

    elif event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
    ):
        _handle_subscription_event(db, event_type, data_object)

    elif event_type == "invoice.paid":
        # Payment succeeded (could be renewal or recovery from past_due)
        _handle_invoice_paid(db, data_object)

    elif event_type in ("invoice.payment_failed", "invoice.payment_action_required"):
        # Payment failed or requires 3DS / action — flip to past_due
        _handle_invoice_payment_failed(db, event_type, data_object)

    else:
        logger.info("Ignoring unhandled Stripe event type: %s", event_type)


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

def _handle_checkout_completed(db: Session, session_obj: Dict[str, Any]) -> None:
    """
    Checkout session completed → attach customer/subscription IDs, activate plan.
    Org is identified via metadata.cei_org_id.
    """
    metadata = session_obj.get("metadata", {}) or {}
    org_id_raw = metadata.get("cei_org_id")
    plan_key = metadata.get("cei_plan_key")

    if not org_id_raw:
        logger.warning("checkout.session.completed missing cei_org_id metadata; ignoring.")
        return

    try:
        org_id = int(org_id_raw)
    except (TypeError, ValueError):
        logger.warning("checkout.session.completed non-integer cei_org_id=%r; ignoring.", org_id_raw)
        return

    org: Optional[Organization] = db.get(Organization, org_id)
    if not org:
        logger.warning("checkout.session.completed unknown org id=%s; ignoring.", org_id)
        return

    _apply_org_plan_update(
        db,
        org,
        OrgPlanUpdate(
            plan_key=plan_key,
            status="active",
            stripe_customer_id=session_obj.get("customer"),
            stripe_subscription_id=session_obj.get("subscription"),
        ),
    )


def _handle_subscription_event(
    db: Session,
    event_type: str,
    subscription_obj: Dict[str, Any],
) -> None:
    """
    Handle customer.subscription.created / updated / deleted / paused.

    Status mapping:
      deleted  → "canceled"
      paused   → "paused"
      all others → subscription_obj["status"] verbatim (active / trialing / past_due / etc.)
    """
    customer_id = subscription_obj.get("customer")
    if not customer_id:
        logger.warning("%s without customer id; ignoring.", event_type)
        return

    org = _org_by_customer_id(db, customer_id, event_type)
    if not org:
        return

    # Derive plan key
    metadata = subscription_obj.get("metadata", {}) or {}
    plan_key = metadata.get("cei_plan_key") or _plan_key_from_subscription_items(subscription_obj)

    # Status: Stripe uses "canceled" for deletions, "paused" for pauses
    stripe_status = subscription_obj.get("status")
    if event_type == "customer.subscription.deleted":
        stripe_status = "canceled"
    elif event_type == "customer.subscription.paused":
        stripe_status = "paused"

    _apply_org_plan_update(
        db,
        org,
        OrgPlanUpdate(
            plan_key=plan_key,
            status=stripe_status,
            stripe_customer_id=customer_id,
            stripe_subscription_id=subscription_obj.get("id"),
        ),
    )


def _handle_invoice_paid(db: Session, invoice_obj: Dict[str, Any]) -> None:
    """
    invoice.paid → payment succeeded.

    This fires on every successful charge (new subscription, renewal, or
    recovery from past_due). We flip status back to "active" and re-enable
    features so a recovered org regains access immediately.
    """
    customer_id = invoice_obj.get("customer")
    if not customer_id:
        logger.warning("invoice.paid without customer id; ignoring.")
        return

    org = _org_by_customer_id(db, customer_id, "invoice.paid")
    if not org:
        return

    # Only flip to active if currently degraded — don't downgrade trialing orgs
    current_status = (getattr(org, "subscription_status", None) or "").lower()
    if current_status in ACTIVE_STATUSES:
        logger.info(
            "invoice.paid for org %s already active (status=%s); no change.",
            getattr(org, "id", None),
            current_status,
        )
        return

    # Keep existing plan key — don't overwrite with None
    existing_plan = getattr(org, "subscription_plan_key", None)

    _apply_org_plan_update(
        db,
        org,
        OrgPlanUpdate(
            plan_key=existing_plan,
            status="active",
            stripe_customer_id=customer_id,
            stripe_subscription_id=invoice_obj.get("subscription"),
        ),
    )


def _handle_invoice_payment_failed(
    db: Session,
    event_type: str,
    invoice_obj: Dict[str, Any],
) -> None:
    """
    invoice.payment_failed / invoice.payment_action_required
    → flip to past_due and disable features.

    Stripe will retry failed payments automatically. If retries are exhausted
    it fires customer.subscription.deleted which we also handle.
    """
    customer_id = invoice_obj.get("customer")
    if not customer_id:
        logger.warning("%s without customer id; ignoring.", event_type)
        return

    org = _org_by_customer_id(db, customer_id, event_type)
    if not org:
        return

    existing_plan = getattr(org, "subscription_plan_key", None)

    _apply_org_plan_update(
        db,
        org,
        OrgPlanUpdate(
            plan_key=existing_plan,
            status="past_due",
            stripe_customer_id=customer_id,
            stripe_subscription_id=invoice_obj.get("subscription"),
        ),
    )


# ---------------------------------------------------------------------------
# Core apply + managing org cascade
# ---------------------------------------------------------------------------

def _apply_org_plan_update(
    db: Session,
    org: Organization,
    update: OrgPlanUpdate,
) -> None:
    """
    Apply a plan/status update to an org and commit.

    Also handles the managing org cascade:
    - If this org is a managing org, propagate feature flag changes to all
      its client orgs. Client orgs keep their own plan_key and status — only
      their enable_* flags are affected by the managing org's payment health.
    """
    org_id = getattr(org, "id", None)
    old_status = getattr(org, "subscription_status", None)

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
    if hasattr(org, "stripe_status") and update.status is not None:
        setattr(org, "stripe_status", update.status)

    # Feature flags
    active = update.status in ACTIVE_STATUSES
    has_plan = bool(update.plan_key)
    enable_features = bool(active and has_plan)

    _set_feature_flags(org, enable_features)

    db.add(org)

    # Managing org cascade — propagate feature flag changes to client orgs
    org_type = (getattr(org, "org_type", None) or "").lower()
    if org_type == "managing" and update.status is not None:
        _cascade_to_client_orgs(db, managing_org_id=org_id, enable_features=enable_features)

    try:
        db.commit()
        logger.info(
            "Stripe plan update applied: org=%s plan=%s status=%s->%s alerts=%s reports=%s",
            org_id,
            getattr(org, "subscription_plan_key", None),
            old_status,
            getattr(org, "subscription_status", None),
            getattr(org, "enable_alerts", None),
            getattr(org, "enable_reports", None),
        )
    except Exception:
        db.rollback()
        logger.exception("Failed to persist Stripe plan update for org %s", org_id)
        raise


def _cascade_to_client_orgs(
    db: Session,
    managing_org_id: int,
    enable_features: bool,
) -> None:
    """
    Propagate feature flag changes from a managing org to all its client orgs.

    Client orgs keep their own plan_key and subscription_status. Only their
    enable_alerts / enable_reports / enable_insights flags are touched —
    because it's the managing org paying the bill.
    """
    client_orgs: List[Organization] = (
        db.query(Organization)
        .filter(Organization.managed_by_org_id == managing_org_id)
        .all()
    )

    if not client_orgs:
        return

    for client_org in client_orgs:
        _set_feature_flags(client_org, enable_features)
        db.add(client_org)

    logger.info(
        "Cascaded feature flags (enable=%s) from managing org %s to %d client org(s).",
        enable_features,
        managing_org_id,
        len(client_orgs),
    )


def _set_feature_flags(org: Organization, enabled: bool) -> None:
    """Set enable_alerts / enable_reports / enable_insights on an org object."""
    if hasattr(org, "enable_alerts"):
        setattr(org, "enable_alerts", enabled)
    if hasattr(org, "enable_reports"):
        setattr(org, "enable_reports", enabled)
    if hasattr(org, "enable_insights"):
        setattr(org, "enable_insights", enabled)


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

def _org_by_customer_id(
    db: Session,
    customer_id: str,
    event_type: str,
) -> Optional[Organization]:
    """Look up an Organization by stripe_customer_id. Logs and returns None if not found."""
    try:
        org = (
            db.query(Organization)
            .filter(Organization.stripe_customer_id == customer_id)
            .first()
        )
    except Exception:
        logger.exception(
            "Error querying Organization by stripe_customer_id=%s (event=%s)",
            customer_id,
            event_type,
        )
        return None

    if not org:
        logger.warning(
            "%s for unknown stripe_customer_id=%s; ignoring.",
            event_type,
            customer_id,
        )
    return org


def _plan_key_from_subscription_items(subscription_obj: Dict[str, Any]) -> Optional[str]:
    """
    Infer CEI plan key from the first subscription item's price.id,
    using PLAN_TO_STRIPE_PRICE as the reverse-lookup source of truth.
    """
    items = subscription_obj.get("items", {}) or {}
    data = items.get("data") or []
    if not data:
        return None
    price_id = (data[0].get("price", {}) or {}).get("id")
    if not price_id:
        return None
    for key, mapped_price_id in PLAN_TO_STRIPE_PRICE.items():
        if mapped_price_id == price_id:
            return key
    return None