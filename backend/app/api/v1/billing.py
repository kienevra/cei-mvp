# backend/app/api/v1/billing.py
import os
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from typing import Dict
from app.api.v1.auth import get_current_user
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models import Subscription, BillingPlan, User
from datetime import datetime
from sqlalchemy.exc import SQLAlchemyError

# Configure Stripe from env
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")  # e.g. sk_test_...
WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")  # set when using stripe CLI / dashboard

router = APIRouter(prefix="/billing", tags=["billing"])


@router.post("/create-checkout-session")
def create_checkout_session(
    payload: Dict,
    current_user: User = Depends(get_current_user),
):
    """
    Create a Stripe Checkout Session for a monthly subscription with a 6-month free trial.

    Request JSON (example):
    {
      "price_id": "price_1Kxxxxxxx",          # required: a Stripe Price id (recurring monthly)
      "success_url": "https://your-front/success",
      "cancel_url": "https://your-front/cancel"
    }

    Note: Create a recurring Price in the Stripe Dashboard beforehand (monthly price).
    """
    price_id = payload.get("price_id")
    success_url = payload.get("success_url")
    cancel_url = payload.get("cancel_url")

    if not price_id or not success_url or not cancel_url:
        raise HTTPException(status_code=400, detail="price_id, success_url and cancel_url are required")

    try:
        # Create or reuse a Stripe Customer for this user (we use email and metadata)
        # Best practice: store stripe_customer_id in your DB on Subscription or User record.
        # For simplicity we create a customer here and let the webhook persist mapping.
        customer = stripe.Customer.create(
            email=current_user.email,
            metadata={"user_id": str(current_user.id)}
        )

        # Create Checkout Session for subscription mode
        session = stripe.checkout.Session.create(
            customer=customer.id,
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            subscription_data={
                # give 6 months free trial (approx 180 days)
                "trial_period_days": 180,
                # store metadata so webhook can link session -> user
                "metadata": {"user_id": str(current_user.id)},
            },
            success_url=success_url + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=cancel_url,
        )
        return {"url": session.url, "id": session.id}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/webhook", status_code=200)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Stripe webhook endpoint. Configure this URL in Stripe dashboard or via stripe CLI.
    Recommended events to subscribe:
      - checkout.session.completed
      - invoice.paid
      - invoice.payment_failed
      - customer.subscription.updated
      - customer.subscription.deleted
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    # verify signature only if WEBHOOK_SECRET is set (recommended)
    try:
        if WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
        else:
            # Unsafe: fallback to parsing without verification (only for dev)
            event = stripe.Event.construct_from(await request.json(), stripe.api_key)
    except Exception as exc:
        # signature verification failed or parse error
        raise HTTPException(status_code=400, detail=f"Webhook error: {exc}")

    try:
        typ = event["type"]
        data = event["data"]["object"]

        # 1) Completed checkout -> create local Subscription record (trial may be active)
        if typ == "checkout.session.completed":
            session = data
            # Session may contain subscription id or customer
            stripe_subscription_id = session.get("subscription")
            stripe_customer_id = session.get("customer")
            metadata = session.get("metadata") or {}
            user_id = metadata.get("user_id")

            # Persist subscription in DB (if subscription not yet created, skip until customer.subscription.created)
            if stripe_subscription_id and user_id:
                # Example: store minimal subscription record
                sub = Subscription(
                    user_id=int(user_id),
                    stripe_customer_id=stripe_customer_id,
                    stripe_subscription_id=stripe_subscription_id,
                    status="active",  # initial assumption; webhook updates will follow
                )
                db.add(sub)
                db.commit()
                db.refresh(sub)

        # 2) subscription update events -> sync status & current_period_end
        elif typ in ("customer.subscription.updated", "customer.subscription.created"):
            subobj = data
            stripe_subscription_id = subobj.get("id")
            status_val = subobj.get("status")
            current_period_end = subobj.get("current_period_end")
            # Map to DB subscription
            existing = db.query(Subscription).filter(Subscription.stripe_subscription_id == stripe_subscription_id).first()
            if existing:
                existing.status = status_val
                if current_period_end:
                    # convert epoch -> datetime
                    existing.current_period_end = datetime.utcfromtimestamp(int(current_period_end))
                db.add(existing)
                db.commit()

        # 3) invoice.payment_failed -> mark subscription (could implement email / retry)
        elif typ == "invoice.payment_failed":
            inv = data
            sid = inv.get("subscription")
            if sid:
                existing = db.query(Subscription).filter(Subscription.stripe_subscription_id == sid).first()
                if existing:
                    existing.status = "past_due"
                    db.add(existing)
                    db.commit()

        # 4) invoice.paid -> ensure subscription active
        elif typ == "invoice.paid":
            inv = data
            sid = inv.get("subscription")
            if sid:
                existing = db.query(Subscription).filter(Subscription.stripe_subscription_id == sid).first()
                if existing:
                    existing.status = "active"
                    db.add(existing)
                    db.commit()

        # ignore other events or add handlers as needed
    except SQLAlchemyError as e:
        # Log & return 200 to avoid webhook retries if you intentionally want that
        return JSONResponse(status_code=200, content={"received": True, "db_error": str(e)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return JSONResponse(status_code=200, content={"received": True})
