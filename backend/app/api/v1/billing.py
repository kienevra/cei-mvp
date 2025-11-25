# backend/app/api/v1/billing.py
from __future__ import annotations

import logging
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models import Organization  # type: ignore

from app.services.stripe_billing import (
    get_stripe_config,
    snapshot_org_stripe_state,
    CheckoutSessionParams,
    create_checkout_session_for_org,
)

logger = logging.getLogger("cei")

router = APIRouter(prefix="/billing", tags=["billing"])


# ========= DTOs / schemas =========


class BillingPlanPublic(BaseModel):
    """
    Public view of a plan. For now this is just a placeholder.

    Later we can:
      - load real BillingPlan rows from the DB
      - expose fields like monthly_price, currency, hard limits, etc.
    """

    key: str
    name: str
    description: Optional[str] = None
    is_default: bool = False


class BillingOverviewOut(BaseModel):
    """
    What the frontend needs to render a simple Billing page
    *without* caring about Stripe internals.
    """

    org_id: Optional[int]
    org_name: Optional[str] = None

    current_plan: Optional[BillingPlanPublic] = None
    billing_status: str = "unknown"

    stripe_enabled: bool
    stripe_api_key_present: bool
    stripe_webhook_secret_present: bool

    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_status: Optional[str] = None


class CheckoutSessionCreateIn(BaseModel):
    """
    Payload from the frontend asking to start a plan change
    (or initial subscription) via Stripe Checkout.
    """

    plan_key: str
    success_url: str
    cancel_url: str


class CheckoutSessionCreateOut(BaseModel):
    """
    What the frontend gets back: a hosted checkout URL.
    """

    provider: Literal["stripe"] = "stripe"
    checkout_url: str


class PortalSessionCreateOut(BaseModel):
    """
    Hosted self-service billing portal (Stripe customer portal).
    """

    provider: Literal["stripe"] = "stripe"
    portal_url: str


# ========= Helpers =========


def _get_org_for_user(db: Session, user) -> Organization:
    """
    Resolve the Organization for the current user.

    We keep this defensive so it doesn't explode if your User model
    evolves. Priority:
      1) user.organization (relationship)
      2) user.organization_id or user.org_id
    """
    org = getattr(user, "organization", None)
    if org is not None:
        return org

    org_id = (
        getattr(user, "organization_id", None)
        or getattr(user, "org_id", None)
    )
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not linked to any organization.",
        )

    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization {org_id} not found.",
        )
    return org


def _build_default_plan_for_now() -> BillingPlanPublic:
    """
    Temporary, hard-coded plan so the UI has something to show
    until we wire real BillingPlan rows.
    """
    return BillingPlanPublic(
        key="cei-starter",
        name="CEI Starter",
        description="Up to 3 sites, 12-month rolling history, CSV ingestion.",
        is_default=True,
    )


# ========= Routes =========


@router.get(
    "/overview",
    response_model=BillingOverviewOut,
    status_code=status.HTTP_200_OK,
)
def get_billing_overview(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> BillingOverviewOut:
    """
    Return a concise view of the current org's billing state.

    Today this is mostly:
      - org id + name
      - whether Stripe is configured at all
      - whatever Stripe IDs we already have on the org (if any)

    Later we can:
      - read BillingPlan / Subscription tables
      - compute usage vs plan limits
    """
    cfg = get_stripe_config()
    org = _get_org_for_user(db, user)
    org_snap = snapshot_org_stripe_state(db, org)

    # For now, everyone is on a single "CEI Starter" plan in the UI.
    current_plan = _build_default_plan_for_now()

    return BillingOverviewOut(
        org_id=getattr(org, "id", None),
        org_name=getattr(org, "name", None),

        current_plan=current_plan,
        billing_status=org_snap.stripe_status or "unknown",

        stripe_enabled=cfg.enabled,
        stripe_api_key_present=cfg.api_key_present,
        stripe_webhook_secret_present=cfg.webhook_secret_present,

        stripe_customer_id=org_snap.stripe_customer_id,
        stripe_subscription_id=org_snap.stripe_subscription_id,
        stripe_status=org_snap.stripe_status,
    )


@router.post(
    "/checkout-session",
    response_model=CheckoutSessionCreateOut,
    status_code=status.HTTP_200_OK,
)
def create_billing_checkout_session(
    payload: CheckoutSessionCreateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> CheckoutSessionCreateOut:
    """
    Start a Stripe Checkout session for the current org.

    *Important at this stage:*
      - If Stripe is NOT configured, we fail fast with a 400 and a clear message.
      - The underlying service function still raises NotImplementedError
        in this step of the roadmap – that's expected until we wire real Stripe.
    """
    cfg = get_stripe_config()
    if not cfg.enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Stripe is not configured (no usable API key). "
                "Set STRIPE_API_KEY / stripe_api_key in backend settings "
                "before using the billing checkout flow."
            ),
        )

    org = _get_org_for_user(db, user)

    params = CheckoutSessionParams(
        plan_key=payload.plan_key,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )

    try:
        result = create_checkout_session_for_org(db, org, params)
    except NotImplementedError as e:
        # Step 2: we deliberately surface a 501 so it's obvious in testing
        logger.warning("Checkout requested but not implemented: %s", e)
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "Stripe Checkout is not implemented yet at this step of the CEI "
                "billing roadmap. The API surface is in place and ready to be wired."
            ),
        )
    except RuntimeError as e:
        # e.g. Stripe disabled at service layer
        logger.warning("Stripe runtime error during checkout: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:  # ultra-defensive
        logger.exception("Unexpected error creating checkout session: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error creating Stripe checkout session.",
        )

    # Once we wire Stripe for real, result.url will be a hosted checkout URL.
    return CheckoutSessionCreateOut(checkout_url=result.url)


@router.post(
    "/portal-session",
    response_model=PortalSessionCreateOut,
    status_code=status.HTTP_200_OK,
)
def create_billing_portal_session(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> PortalSessionCreateOut:
    """
    Skeleton for a Stripe Billing Portal session.

    In a later step we will:
      - ensure the org has a stripe_customer_id
      - call stripe.billing_portal.Session.create(...)
      - return the hosted portal URL

    For now, we just:
      - validate that Stripe is configured
      - return a 501 Not Implemented, so frontend knows the capability
        exists but isn't active yet.
    """
    cfg = get_stripe_config()
    if not cfg.enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Stripe is not configured (no usable API key). "
                "Set STRIPE_API_KEY / stripe_api_key in backend settings "
                "before using the billing portal."
            ),
        )

    # We still resolve org so we can log / audit
    org = _get_org_for_user(db, user)
    logger.info(
        "Billing portal requested for org %s – Stripe portal integration "
        "not implemented at this step.",
        getattr(org, "id", None),
    )

    # 501 signals: "this endpoint is legit but not yet implemented"
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            "Stripe Billing Portal integration is not implemented yet. "
            "The endpoint is reserved and ready for wiring in a later step."
        ),
    )
