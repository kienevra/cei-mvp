# backend/app/api/v1/billing.py
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from typing import Any, Optional
import os
import logging
import stripe

from app.api.v1.auth import get_current_user  # auth dependency
from app.db.session import get_db
from sqlalchemy.orm import Session
from app.models import Subscription, BillingPlan, User  # DB models for persistence (placeholders)

logger = logging.getLogger("cei.billing")
router = APIRouter(prefix="/billing", tags=["billing"])

# initialize stripe
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
PRICE_ID = os.environ.get("STRIPE_PRICE_ID_MONTHLY")  # should be set in env
TRIAL_DAYS = int(os.environ.get("STRIPE_TRIAL_DAYS", "182"))  # default to ~6 months
FRONTEND_URL = os.environ.get("FRONTEND_URL", os.environ.get("VITE_API_URL", "http://localhost:5173"))

@router.post("/create-checkout-session")
def create_checkout_session(db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    """
    Create a Stripe Checkout session for a subscription with a trial.
    Returns a JSON with { "sessionId": "<stripe-session-id>" }.

    Frontend should redirect to: https://checkout.stripe.com/pay/<sessionId>
    """
    if not PRICE_ID:
        logger.error("Stripe price ID not configured (STRIPE_PRICE_ID_MONTHLY).")
        raise HTTPException(status_code=500, detail="Payment configuration not present")

    # Ensure user email available
    email = getattr(current_user, "email", None) or None

    # Create or fetch a Stripe Customer (for simplicity we create a customer here).
    # In production, you'd store stripe_customer_id on the User or Subscription row and reuse it.
    try:
        customer = stripe.Customer.create(email=email, metadata={"user_id": str(getattr(current_user, "id", ""))})
    except stripe.error.StripeError as e:
        logger.exception("Failed to create Stripe customer")
        raise HTTPException(status_code=502, detail=str(e))

    try:
        session = stripe.checkout.Session.create(
            customer=customer.id,
            mode="subscription",
            line_items=[{"price": PRICE_ID, "quantity": 1}],
            subscription_data={"trial_period_days": TRIAL_DAYS},
            metadata={"user_id": str(getattr(current_user, "id", ""))},
            success_url=f"{FRONTEND_URL.rstrip('/')}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{FRONTEND_URL.rstrip('/')}/billing/cancel",
        )
    except stripe.error.StripeError as e:
        logger.exception("Stripe checkout session creation failed")
        raise HTTPException(status_code=502, detail=str(e))

    # Optionally, persist a staging subscription record in DB here (status = 'checkout_pending')
    # Example (pseudo):
    # db_sub = Subscription(user_id=current_user.id, stripe_customer_id=customer.id,
    #                      stripe_subscription_id="", status="checkout_pending")
    # db.add(db_sub); db.commit(); db.refresh(db_sub)

    return {"sessionId": session.id}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Stripe webhook endpoint. Configure STRIPE_WEBHOOK_SECRET in env for signature verification.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    endpoint_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")
    event = None

    try:
        if endpoint_secret:
            event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
        else:
            # insecure fallback for dev only - log heavily if used
            logger.warning("⚠️ STRIPE_WEBHOOK_SECRET not set — using insecure webhook parsing (dev only)")
            event = stripe.Event.construct_from(stripe.util.json.loads(payload), stripe.api_key)
    except ValueError:
        logger.exception("Invalid payload from Stripe webhook")
        return JSONResponse(status_code=400, content={"error": "Invalid payload"})
    except stripe.error.SignatureVerificationError:
        logger.exception("Stripe webhook signature verification failed")
        return JSONResponse(status_code=400, content={"error": "Invalid signature"})

    # Handle relevant events
    typ = event.get("type")
    logger.info("Received Stripe event: %s", typ)

    # NOTE: implement DB write logic here (lookup by metadata, session.customer, or session.metadata)
    try:
        if typ == "checkout.session.completed":
            session = event["data"]["object"]
            # session.subscription contains the subscription id
            # Use session.customer or session.metadata["user_id"] to locate CEI user
            logger.info("Checkout session completed: %s", session.get("id"))
            # TODO: write subscription record in DB using stripe subscription id
        elif typ == "invoice.payment_succeeded":
            invoice = event["data"]["object"]
            logger.info("Invoice payment succeeded: %s", invoice.get("id"))
            # TODO: mark subscription active / update status
        elif typ == "customer.subscription.updated":
            sub = event["data"]["object"]
            logger.info("Subscription updated: %s", sub.get("id"))
            # TODO: sync subscription status and current_period_end to DB
        elif typ == "customer.subscription.deleted":
            sub = event["data"]["object"]
            logger.info("Subscription canceled/deleted: %s", sub.get("id"))
            # TODO: mark subscription canceled in DB
        else:
            logger.debug("Unhandled Stripe event type: %s", typ)
    except Exception:
        logger.exception("Error handling Stripe webhook event")

    return JSONResponse(status_code=200, content={"received": True})
