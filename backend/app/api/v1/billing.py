from __future__ import annotations

import logging
from typing import Optional

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
    create_portal_session_for_org,
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
    Frontend expects a simple `{ url?: string }` shape.
    If `url` is null/omitted, the UI shows a "not configured" message.
    """

    url: Optional[str] = None


class PortalSessionCreateIn(BaseModel):
    """
    Payload from the frontend asking to open the billing portal.
    """

    return_url: str


class PortalSessionCreateOut(BaseModel):
    """
    Frontend expects a simple `{ url?: string }` shape.
    If `url` is null/omitted, the UI shows a "not configured" message.
    """

    url: Optional[str] = None


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
    "/checkout",
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

    Behavior:
      - If Stripe is NOT configured, we return 200 with `url = null`,
        so the frontend can show a friendly "billing not configured" banner.
      - If Stripe *is* configured but something is miswired, we surface
        a clean 4xx/5xx with a useful message.
      - Org scoping is enforced via the current user.
    """
    cfg = get_stripe_config()
    if not cfg.enabled:
        logger.info(
            "Checkout requested but Stripe is not enabled. "
            "Returning null URL for org-scoped checkout."
        )
        return CheckoutSessionCreateOut(url=None)

    org = _get_org_for_user(db, user)

    params = CheckoutSessionParams(
        plan_key=payload.plan_key,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )

    try:
        result = create_checkout_session_for_org(db, org, params)
    except RuntimeError as e:
        # e.g. unknown plan key, missing SDK, or org missing required fields
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

    return CheckoutSessionCreateOut(url=result.url)


@router.post(
    "/portal",
    response_model=PortalSessionCreateOut,
    status_code=status.HTTP_200_OK,
)
def create_billing_portal_session(
    payload: PortalSessionCreateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> PortalSessionCreateOut:
    """
    Create a Stripe Billing Portal session for the current org.

    Behavior:
      - If Stripe is NOT configured, we return 200 with `url = null`,
        so the frontend can surface a "portal not configured" message.
      - If Stripe *is* configured but the org has no customer, we 400
        with a clear explanation.
      - Otherwise we return the hosted portal URL.
    """
    cfg = get_stripe_config()
    if not cfg.enabled:
        logger.info(
            "Billing portal requested but Stripe is not enabled. "
            "Returning null URL for org-scoped portal."
        )
        return PortalSessionCreateOut(url=None)

    org = _get_org_for_user(db, user)

    try:
        result = create_portal_session_for_org(
            db=db,
            org=org,
            return_url=payload.return_url,
        )
    except RuntimeError as e:
        logger.warning("Stripe runtime error during billing portal: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.exception("Unexpected error creating billing portal session: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error creating Stripe billing portal session.",
        )

    return PortalSessionCreateOut(url=result.url)
