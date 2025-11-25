# backend/app/api/v1/stripe_webhook.py
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.stripe_billing import get_stripe_config

logger = logging.getLogger("cei")

router = APIRouter(prefix="/stripe", tags=["stripe"])

try:
    import stripe  # type: ignore
except ImportError:
    stripe = None  # type: ignore


@router.post(
    "/webhook",
    status_code=status.HTTP_200_OK,
)
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
    stripe_signature: str = Header("", alias="Stripe-Signature"),
):
    """
    Minimal Stripe webhook handler.

    Handles subscription lifecycle events and best-effort updates the
    organization with Stripe subscription id + status, IF the model has
    those fields.

    Safe behaviours:
      - If Stripe SDK is missing, we just log + 200 (no crash).
      - If webhook secret is missing, we parse without signature validation,
        but log a big warning (dev-only acceptable).
    """
    cfg = get_stripe_config()
    body = await request.body()

    if stripe is None:
        logger.warning(
            "Stripe SDK not installed; ignoring webhook payload "
            "(install via `pip install stripe`)."
        )
        return {"received": True, "processed": False, "reason": "stripe_not_installed"}

    # Try to build Event with or without signature validation
    if cfg.webhook_secret:
        try:
            event = stripe.Webhook.construct_event(  # type: ignore[attr-defined]
                payload=body,
                sig_header=stripe_signature,
                secret=cfg.webhook_secret,
            )
        except stripe.error.SignatureVerificationError as e:  # type: ignore[attr-defined]
            logger.warning("Invalid Stripe webhook signature: %s", e)
            raise HTTPException(status_code=400, detail="Invalid signature")
        except Exception as e:
            logger.error("Error parsing Stripe webhook: %s", e)
            raise HTTPException(status_code=400, detail="Invalid payload")
    else:
        logger.warning(
            "Stripe webhook secret not configured; skipping signature "
            "verification. This is acceptable only in local/dev."
        )
        try:
            parsed = json.loads(body.decode("utf-8"))
        except Exception as e:
            logger.error("Failed to decode Stripe webhook body: %s", e)
            raise HTTPException(status_code=400, detail="Invalid payload")
        event = stripe.Event.construct_from(  # type: ignore[attr-defined]
            parsed,
            stripe.api_key or None,
        )

    event_type = event["type"]
    data_object = event["data"]["object"]

    logger.info("Stripe webhook event received: %s", event_type)

    if event_type.startswith("customer.subscription."):
        _handle_subscription_event(db, data_object)

    # Everything else is just acknowledged for now
    return {"received": True}


def _handle_subscription_event(db: Session, obj: Any) -> None:
    """
    Update org stripe_subscription_id / stripe_status from subscription event.

    Assumes:
      - subscription.metadata.cei_org_id was set by checkout code.
      - Organization model *may* have these fields; we only persist if present.
    """
    from app.models import Organization  # type: ignore

    metadata = getattr(obj, "metadata", None) or obj.get("metadata", {})  # type: ignore[arg-type]
    org_id_raw = metadata.get("cei_org_id")
    if not org_id_raw:
        logger.warning("Stripe subscription event missing cei_org_id metadata; ignoring.")
        return

    try:
        org_id = int(org_id_raw)
    except (TypeError, ValueError):
        logger.warning("Invalid cei_org_id value in metadata: %r", org_id_raw)
        return

    org: Organization | None = db.get(Organization, org_id)
    if not org:
        logger.warning("Stripe webhook: Organization %s not found.", org_id)
        return

    sub_id = obj.get("id")
    status = obj.get("status")

    updated = False

    if hasattr(org, "stripe_subscription_id"):
        setattr(org, "stripe_subscription_id", sub_id)
        updated = True
    if hasattr(org, "stripe_status"):
        setattr(org, "stripe_status", status)
        updated = True

    if updated:
        db.add(org)
        db.commit()
        logger.info(
            "Org %s updated from Stripe subscription event: sub_id=%s, status=%s",
            org_id,
            sub_id,
            status,
        )
    else:
        logger.info(
            "Org %s has no Stripe subscription fields defined; "
            "event processed but not persisted.",
            org_id,
        )
