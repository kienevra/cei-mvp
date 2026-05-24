from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional, Dict

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Organization  # type: ignore

logger = logging.getLogger("cei")

try:
    import stripe  # type: ignore
except ImportError:
    stripe = None  # type: ignore


# ========= Config / snapshots =========


@dataclass
class StripeConfig:
    enabled: bool
    api_key_present: bool
    webhook_secret_present: bool
    api_key: Optional[str] = None
    webhook_secret: Optional[str] = None


@dataclass
class StripeOrgSnapshot:
    org_id: Optional[int]
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]
    stripe_status: Optional[str]


def get_stripe_config() -> StripeConfig:
    """
    Central place to read Stripe credentials from settings/env and decide
    whether Stripe is 'enabled' for this deployment.
    """
    # Prefer settings.*, fall back to env vars if not present
    api_key = getattr(settings, "stripe_api_key", None) or os.getenv("STRIPE_API_KEY")
    webhook_secret = (
        getattr(settings, "stripe_webhook_secret", None)
        or os.getenv("STRIPE_WEBHOOK_SECRET")
    )

    enabled = bool(api_key)

    # If stripe SDK is installed, set api_key globally once
    if stripe is not None and api_key:
        stripe.api_key = api_key
    elif api_key and stripe is None:
        # Configured but SDK missing – this will surface as a RuntimeError
        # when we actually try to use Stripe.
        logger.warning(
            "Stripe API key is set but the 'stripe' SDK is not installed. "
            "Billing operations will fail until the package is installed."
        )

    return StripeConfig(
        enabled=enabled,
        api_key_present=bool(api_key),
        webhook_secret_present=bool(webhook_secret),
        api_key=api_key,
        webhook_secret=webhook_secret,
    )


def snapshot_org_stripe_state(db: Session, org: Organization) -> StripeOrgSnapshot:
    """
    Lightweight, defensive read of Stripe-related fields on the org.

    We do NOT require that these columns exist; if the model doesn't have
    them yet, we just return None for each.
    """
    org_id = getattr(org, "id", None)
    stripe_customer_id = getattr(org, "stripe_customer_id", None)
    stripe_subscription_id = getattr(org, "stripe_subscription_id", None)
    stripe_status = getattr(org, "stripe_status", None)

    return StripeOrgSnapshot(
        org_id=org_id,
        stripe_customer_id=stripe_customer_id,
        stripe_subscription_id=stripe_subscription_id,
        stripe_status=stripe_status,
    )


# ========= Checkout + Portal params / results =========


@dataclass
class CheckoutSessionParams:
    plan_key: str
    success_url: str
    cancel_url: str


@dataclass
class CheckoutSessionResult:
    url: str


@dataclass
class PortalSessionResult:
    url: str


# Map CEI logical plan keys -> Stripe Price IDs.
# You MUST update these values with real Stripe price IDs when you wire Stripe.
PLAN_TO_STRIPE_PRICE: Dict[str, str] = {
    # Standalone org — base fee
    "standalone_base":     "price_1Tac8L1UT0Q5Ec7jEA7o4aMG",   # EUR 89/month
    # Standalone org — per site
    "standalone_per_site": "price_1TacMj1UT0Q5Ec7jPCPMRSu8",   # EUR 59/site/month
    # Manager — base fee
    "manager_base":        "price_1TacNy1UT0Q5Ec7jPS7ZEcCh",   # EUR 149/month
    # Manager — per site
    "manager_per_site":    "price_1TacPG1UT0Q5Ec7jw04igBJN",   # EUR 39/site/month
}


# ========= Core Stripe helpers =========


def _require_stripe_sdk() -> None:
    """
    Make sure the 'stripe' Python package is installed.
    """
    if stripe is None:
        raise RuntimeError(
            "Stripe SDK not installed. Install with `pip install stripe` "
            "before using Stripe-based billing."
        )


def create_checkout_session_for_org(
    db: Session,
    org: Organization,
    params: CheckoutSessionParams,
) -> CheckoutSessionResult:
    """
    Create a Stripe Checkout session for a subscription tied to this org.

    Behaviour:
    - If Stripe is misconfigured or SDK missing, raises RuntimeError (which
      the API layer turns into a clean 4xx).
    - If org has no stripe_customer_id and the model supports it, we create
      a Customer and best-effort persist the ID.
    - We set metadata on the Session so webhook handlers can map back to org.
    """
    cfg = get_stripe_config()
    if not cfg.enabled or not cfg.api_key:
        raise RuntimeError(
            "Stripe is not configured. Set STRIPE_API_KEY / stripe_api_key "
            "before creating checkout sessions."
        )

    _require_stripe_sdk()

    # Resolve price for requested plan
    price_id = PLAN_TO_STRIPE_PRICE.get(params.plan_key)
    if not price_id:
        raise RuntimeError(
            f"Unknown plan_key '{params.plan_key}'. "
            "Configure PLAN_TO_STRIPE_PRICE in app.services.stripe_billing."
        )

    org_id = getattr(org, "id", None)
    org_name = getattr(org, "name", None) or (f"Org {org_id}" if org_id else "CEI Org")

    # --- Ensure a Stripe Customer exists ---
    customer_id = getattr(org, "stripe_customer_id", None)

    if not customer_id:
        # Best-effort email resolution
        email = (
            getattr(org, "billing_email", None)
            or getattr(org, "email", None)
        )

        customer = stripe.Customer.create(  # type: ignore[attr-defined]
            name=org_name,
            email=email,
            metadata={"cei_org_id": str(org_id) if org_id is not None else ""},
        )
        customer_id = customer["id"]

        # Persist customer_id if the model has the field
        if hasattr(org, "stripe_customer_id"):
            try:
                setattr(org, "stripe_customer_id", customer_id)
                db.add(org)
                db.commit()
            except Exception as e:
                logger.exception(
                    "Failed to persist stripe_customer_id on org %s: %s",
                    org_id,
                    e,
                )
        else:
            logger.warning(
                "Organization model has no stripe_customer_id field; "
                "Stripe customer will not be persisted."
            )

    # --- Create Checkout Session ---
    session = stripe.checkout.Session.create(  # type: ignore[attr-defined]
        mode="subscription",
        payment_method_types=["card"],
        customer=customer_id,
        line_items=[
            {
                "price": price_id,
                "quantity": 1,
            }
        ],
        success_url=params.success_url,
        cancel_url=params.cancel_url,
        metadata={
            "cei_org_id": str(org_id) if org_id is not None else "",
            "cei_plan_key": params.plan_key,
        },
    )

    url = session["url"]
    logger.info(
        "Created Stripe checkout session for org %s (plan=%s, session=%s)",
        org_id,
        params.plan_key,
        session["id"],
    )

    return CheckoutSessionResult(url=url)


def create_portal_session_for_org(
    db: Session,
    org: Organization,
    return_url: str,
) -> PortalSessionResult:
    """
    Create a Stripe Billing Portal session for self-service subscription management.

    This assumes:
      - the org has a stripe_customer_id
      - Stripe API key is configured
    """
    cfg = get_stripe_config()
    if not cfg.enabled or not cfg.api_key:
        raise RuntimeError(
            "Stripe is not configured. Set STRIPE_API_KEY / stripe_api_key "
            "before creating billing portal sessions."
        )

    _require_stripe_sdk()

    org_id = getattr(org, "id", None)
    customer_id = getattr(org, "stripe_customer_id", None)

    if not customer_id:
        raise RuntimeError(
            "Organization has no stripe_customer_id. "
            "You must create a customer via checkout first."
        )

    session = stripe.billing_portal.Session.create(  # type: ignore[attr-defined]
        customer=customer_id,
        return_url=return_url,
    )

    url = session["url"]
    logger.info(
        "Created Stripe billing portal session for org %s (customer=%s, portal_session=%s)",
        org_id,
        customer_id,
        session["id"],
    )

    return PortalSessionResult(url=url)

# ---------------------------------------------------------------------------
# Hybrid checkout — base fee + per-site fee in one subscription
# ---------------------------------------------------------------------------

@dataclass
class HybridCheckoutParams:
    org_type: str        # "standalone" or "managing"
    site_count: int      # current number of billable sites
    success_url: str
    cancel_url: str


def create_hybrid_checkout_session(
    db: Session,
    org: Organization,
    params: HybridCheckoutParams,
) -> CheckoutSessionResult:
    """
    Create a Stripe Checkout session with two line items:
      1. Base fee (flat, quantity=1)
      2. Per-site fee (quantity=site_count)

    Standalone orgs:  EUR 89/month + EUR 59 × sites
    Manager orgs:     EUR 149/month + EUR 39 × sites

    On success the webhook (checkout.session.completed) fires and we
    store the subscription ID + set billing_cycle_anchor.
    """
    cfg = get_stripe_config()
    if not cfg.enabled or not cfg.api_key:
        raise RuntimeError(
            "Stripe is not configured. Set STRIPE_API_KEY before creating checkout sessions."
        )
    _require_stripe_sdk()

    if params.org_type == "managing":
        base_price_id     = PLAN_TO_STRIPE_PRICE["manager_base"]
        per_site_price_id = PLAN_TO_STRIPE_PRICE["manager_per_site"]
        plan_key          = "manager"
    else:
        base_price_id     = PLAN_TO_STRIPE_PRICE["standalone_base"]
        per_site_price_id = PLAN_TO_STRIPE_PRICE["standalone_per_site"]
        plan_key          = "standalone"

    org_id   = getattr(org, "id", None)
    org_name = getattr(org, "name", None) or f"Org {org_id}"

    # Ensure Stripe Customer exists
    customer_id = getattr(org, "stripe_customer_id", None)
    if not customer_id:
        email = getattr(org, "billing_email", None) or getattr(org, "contact_email", None)
        customer = stripe.Customer.create(  # type: ignore[attr-defined]
            name=org_name,
            email=email,
            metadata={"cei_org_id": str(org_id) if org_id is not None else ""},
        )
        customer_id = customer["id"]
        if hasattr(org, "stripe_customer_id"):
            try:
                setattr(org, "stripe_customer_id", customer_id)
                db.add(org)
                db.commit()
            except Exception:
                logger.exception("Failed to persist stripe_customer_id for org %s", org_id)

    # Store price IDs on org for future quantity updates
    if hasattr(org, "stripe_base_price_id"):
        org.stripe_base_price_id = base_price_id
    if hasattr(org, "stripe_site_price_id"):
        org.stripe_site_price_id = per_site_price_id
    try:
        db.add(org)
        db.commit()
    except Exception:
        logger.exception("Failed to persist price IDs for org %s", org_id)

    # Build line items
    line_items = [
        {
            "price":    base_price_id,
            "quantity": 1,
        },
    ]
    # Only add per-site line item if there are sites
    # (quantity=0 is not allowed by Stripe)
    if params.site_count > 0:
        line_items.append({
            "price":    per_site_price_id,
            "quantity": params.site_count,
        })

    session = stripe.checkout.Session.create(  # type: ignore[attr-defined]
        mode="subscription",
        payment_method_types=["card"],
        customer=customer_id,
        line_items=line_items,
        success_url=params.success_url,
        cancel_url=params.cancel_url,
        metadata={
            "cei_org_id":         str(org_id) if org_id is not None else "",
            "cei_plan_key":       plan_key,
            "cei_org_type":       params.org_type,
            "cei_site_count":     str(params.site_count),
        },
        subscription_data={
            "metadata": {
                "cei_org_id":   str(org_id) if org_id is not None else "",
                "cei_plan_key": plan_key,
            }
        },
    )

    logger.info(
        "Created hybrid checkout session for org_id=%s plan=%s sites=%s session=%s",
        org_id, plan_key, params.site_count, session["id"],
    )
    return CheckoutSessionResult(url=session["url"])