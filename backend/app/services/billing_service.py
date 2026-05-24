# backend/app/services/billing_service.py
"""
CEI Billing Service
===================
Implements the full billing policy defined in the CEI Pricing & Billing Policy document.

Key rules:
- Standalone orgs: base fee (EUR 89/mo) + per-site fee (EUR 59/site/mo)
- Manager orgs:    base fee (EUR 149/mo) + per-site fee (EUR 39/site/mo)
- All changes take effect on the NEXT billing cycle, never immediately
- Suspension on link, reactivation on unlink
- 1-month client grace period on unlink
- 1-month payment grace period with weekly notifications
- Soft lock after grace period expires
- Manager lockout cascades to clients with 1-month transition period
- Ghost clients require a contact_email; follow same rules as linked clients
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import Organization, Site
from app.services.notification_service import notify, NotifType

logger = logging.getLogger("cei.billing")

# ---------------------------------------------------------------------------
# Stripe Price IDs — fill these in once created in Stripe dashboard
# ---------------------------------------------------------------------------
STRIPE_PRICES = {
    # Standalone org
    "standalone_base":     "price_1Tac8L1UT0Q5Ec7jEA7o4aMG",   # EUR 89/month flat
    "standalone_per_site": "price_1TacMj1UT0Q5Ec7jPCPMRSu8",   # EUR 59/site/month
    # Manager / consultant
    "manager_base":        "price_1TacNy1UT0Q5Ec7jPS7ZEcCh",   # EUR 149/month flat
    "manager_per_site":    "price_1TacPG1UT0Q5Ec7jw04igBJN",   # EUR 39/site/month
}

# Grace period duration
GRACE_PERIOD_DAYS = 30
# Client grace period after unlink
CLIENT_GRACE_DAYS = 30
# Client transition period after manager lockout
TRANSITION_PERIOD_DAYS = 30
# Weekly notification interval during grace period
GRACE_NOTIFY_INTERVAL_DAYS = 7


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Site counting
# ---------------------------------------------------------------------------

def count_billable_sites(org: Organization, db: Session) -> int:
    """
    Count the number of sites billable to this org.

    For standalone orgs: count their own sites.
    For manager orgs: count all sites across all linked client orgs
                      AND all ghost client orgs they created.
    """
    if org.org_type in ("standalone", "client"):
        return db.query(Site).filter(Site.org_id == org.id).count()

    if org.org_type == "managing":
        client_org_ids = [
            o.id for o in db.query(Organization).filter(
                Organization.managed_by_org_id == org.id
            ).all()
        ]
        if not client_org_ids:
            return 0
        return db.query(Site).filter(
            Site.org_id.in_(client_org_ids)
        ).count()

    return 0


def queue_site_count_for_next_cycle(org: Organization, db: Session) -> None:
    """
    Recalculate site count and store it as next_billing_site_count.
    This is called whenever a site or client org is added or removed.
    The count takes effect on the next billing cycle, not immediately.
    """
    count = count_billable_sites(org, db)
    org.next_billing_site_count = count
    db.add(org)
    logger.info(
        "Queued next billing site count for org_id=%s: %s sites",
        org.id, count,
    )


def apply_next_cycle_site_count(org: Organization, db: Session) -> None:
    """
    Called at the start of each billing cycle to lock in the queued site count.
    """
    if org.next_billing_site_count is not None:
        org.billed_site_count = org.next_billing_site_count
        org.next_billing_site_count = None
        db.add(org)
        logger.info(
            "Applied billed_site_count=%s for org_id=%s",
            org.billed_site_count, org.id,
        )


# ---------------------------------------------------------------------------
# Stripe subscription quantity sync
# ---------------------------------------------------------------------------

def sync_stripe_site_quantity(org: Organization, db: Session) -> bool:
    """
    Update the Stripe subscription item quantity to match next_billing_site_count.
    Called when a site/client is added or removed so Stripe knows what to charge
    on the next invoice.

    Returns True if updated, False if Stripe not configured or no subscription.
    Best-effort: never raises — logs on failure.
    """
    try:
        from app.services.stripe_billing import get_stripe_config
        cfg = get_stripe_config()
        if not cfg.enabled:
            return False

        sub_item_id = getattr(org, "stripe_site_subscription_item_id", None)
        site_count  = org.next_billing_site_count

        if not sub_item_id or site_count is None:
            return False

        try:
            import stripe  # type: ignore
        except ImportError:
            return False

        stripe.SubscriptionItem.modify(
            sub_item_id,
            quantity=max(site_count, 0),
        )
        logger.info(
            "Updated Stripe subscription item %s quantity to %s for org_id=%s",
            sub_item_id, site_count, org.id,
        )
        return True

    except Exception:
        logger.exception(
            "sync_stripe_site_quantity failed for org_id=%s", org.id
        )
        return False


# ---------------------------------------------------------------------------
# Subscription suspension (standalone links to manager)
# ---------------------------------------------------------------------------

def schedule_subscription_suspension(
    org: Organization,
    db: Session,
    next_cycle_date: Optional[datetime] = None,
) -> None:
    """
    Called when a standalone org links to a manager.
    Schedules suspension for the next billing cycle — does NOT cancel immediately.
    """
    effective = next_cycle_date or _get_next_cycle_date(org)
    org.suspension_effective_date = effective
    org.subscription_suspended = False  # not yet — kicks in at next cycle
    db.add(org)
    logger.info(
        "Scheduled subscription suspension for org_id=%s, effective=%s",
        org.id, effective,
    )


def apply_subscription_suspension(org: Organization, db: Session) -> None:
    """
    Actually suspends the subscription. Called by the daily billing worker
    when suspension_effective_date has passed.
    Pauses the Stripe subscription if configured.
    """
    org.subscription_suspended = True
    org.suspension_effective_date = None
    db.add(org)

    # Pause Stripe subscription best-effort
    _pause_stripe_subscription(org)

    logger.info("Subscription suspended for org_id=%s", org.id)


def reactivate_subscription(
    org: Organization,
    db: Session,
    next_cycle_date: Optional[datetime] = None,
) -> None:
    """
    Called when a standalone org unlinks from a manager.
    Reactivates subscription from the next billing cycle.
    Also starts the 1-month client grace period.
    """
    org.subscription_suspended = False
    org.suspension_effective_date = None

    # 1-month grace period from unlink date
    org.client_grace_until = _now() + timedelta(days=CLIENT_GRACE_DAYS)
    db.add(org)

    # Resume Stripe subscription best-effort
    _resume_stripe_subscription(org)

    logger.info(
        "Subscription reactivated for org_id=%s, client_grace_until=%s",
        org.id, org.client_grace_until,
    )


def start_client_grace_period(org: Organization, db: Session) -> None:
    """
    Starts the 1-month free coverage period for a client org after unlink.
    After this period, the org must subscribe or link to a new manager.
    """
    org.client_grace_until = _now() + timedelta(days=CLIENT_GRACE_DAYS)
    db.add(org)

    notify(
        db,
        org_id=org.id,
        type=NotifType.ORG_UNLINKED,
        title="Your energy manager has unlinked your account",
        body=(
            f"You have 1 month of continued access. After "
            f"{org.client_grace_until.strftime('%d %b %Y')}, "
            "please subscribe to a CEI plan or link to a new consultant."
        ),
        extra={
            "title_it": "Il tuo gestore energetico ha scollegato il tuo account",
            "body_it": (
                f"Hai 1 mese di accesso continuato. Dopo il "
                f"{org.client_grace_until.strftime('%d/%m/%Y')}, "
                "iscriviti a un piano CEI o collegati a un nuovo consulente."
            ),
            "url": "/account",
        },
    )
    logger.info(
        "Client grace period started for org_id=%s until %s",
        org.id, org.client_grace_until,
    )


# ---------------------------------------------------------------------------
# Payment grace period
# ---------------------------------------------------------------------------

def start_payment_grace_period(org: Organization, db: Session) -> None:
    """
    Called when a payment fails. Starts 1-month grace period with weekly notifications.
    """
    now = _now()
    org.grace_period_started_at = now
    org.grace_period_until = now + timedelta(days=GRACE_PERIOD_DAYS)
    org.last_grace_notification_at = now
    org.subscription_status = "past_due"
    db.add(org)

    # First notification immediately
    _send_grace_period_notification(org, db, week=1)

    logger.info(
        "Payment grace period started for org_id=%s until %s",
        org.id, org.grace_period_until,
    )


def check_and_send_grace_notifications(org: Organization, db: Session) -> None:
    """
    Called by daily worker. Sends weekly notification if due.
    """
    if not org.grace_period_until or not org.grace_period_started_at:
        return

    now = _now()
    if now > org.grace_period_until:
        return  # already expired — handled by apply_soft_lock

    last = org.last_grace_notification_at or org.grace_period_started_at
    if (now - last).days >= GRACE_NOTIFY_INTERVAL_DAYS:
        days_elapsed = (now - org.grace_period_started_at).days
        week = min(4, (days_elapsed // 7) + 1)
        _send_grace_period_notification(org, db, week=week)
        org.last_grace_notification_at = now
        db.add(org)


def clear_payment_grace_period(org: Organization, db: Session) -> None:
    """
    Called when payment is recovered (invoice.paid webhook).
    Clears grace period and restores active status.
    """
    org.grace_period_until = None
    org.grace_period_started_at = None
    org.last_grace_notification_at = None
    org.subscription_status = "active"
    org.soft_locked = False
    org.soft_locked_at = None
    db.add(org)

    notify(
        db,
        org_id=org.id,
        type="payment_recovered",
        title="Payment received — your account is fully active",
        body="Thank you. All features have been restored.",
        extra={
            "title_it": "Pagamento ricevuto — il tuo account è nuovamente attivo",
            "body_it": "Grazie. Tutte le funzionalità sono state ripristinate.",
        },
    )
    logger.info("Payment grace period cleared for org_id=%s", org.id)


# ---------------------------------------------------------------------------
# Soft lock
# ---------------------------------------------------------------------------

def apply_soft_lock(org: Organization, db: Session) -> None:
    """
    Called when grace period expires without payment.
    Applies soft lock: read-only access, no ingestion, no alerts.
    For manager orgs: starts transition period for all client orgs.
    """
    now = _now()
    org.soft_locked = True
    org.soft_locked_at = now
    org.grace_period_until = None
    org.grace_period_started_at = None
    org.subscription_status = "canceled"
    db.add(org)

    notify(
        db,
        org_id=org.id,
        type="account_soft_locked",
        title="Your account has been locked",
        body=(
            "Your payment grace period has expired. Your account is now in "
            "read-only mode. Subscribe to restore full access."
        ),
        extra={
            "title_it": "Il tuo account è stato bloccato",
            "body_it": (
                "Il periodo di grazia per il pagamento è scaduto. Il tuo account "
                "è ora in modalità sola lettura. Iscriviti per ripristinare l'accesso completo."
            ),
            "url": "/account",
        },
    )

    # If this is a managing org, cascade to client orgs
    if org.org_type == "managing":
        _start_client_transition_period(org, db)

    logger.info("Soft lock applied to org_id=%s", org.id)


def apply_client_soft_lock_after_transition(org: Organization, db: Session) -> None:
    """
    Called when a client org's transition period expires after manager lockout.
    Also used for ghost clients whose manager lost privileges.
    """
    now = _now()
    org.soft_locked = True
    org.soft_locked_at = now
    org.transition_period_until = None
    db.add(org)

    # For ghost clients, notify via contact_email
    if org.is_ghost_client and org.contact_email:
        _send_ghost_client_lockout_email(org)

    # For real orgs, send in-app notification
    if not org.is_ghost_client:
        notify(
            db,
            org_id=org.id,
            type="account_soft_locked",
            title="Your account access has expired",
            body=(
                "Your energy manager's account is no longer active and your "
                "transition period has ended. Please subscribe to a CEI plan "
                "or link to a new energy manager to restore access."
            ),
            extra={
                "title_it": "L'accesso al tuo account è scaduto",
                "body_it": (
                    "L'account del tuo gestore energetico non è più attivo e il "
                    "periodo di transizione è terminato. Iscriviti a un piano CEI "
                    "o collegati a un nuovo gestore per ripristinare l'accesso."
                ),
                "url": "/account",
            },
        )

    logger.info(
        "Client soft lock applied to org_id=%s (ghost=%s)",
        org.id, org.is_ghost_client,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_next_cycle_date(org: Organization) -> datetime:
    """
    Returns the start of the next billing cycle.
    If billing_cycle_anchor is set, use it to compute next cycle.
    Otherwise default to 30 days from now.
    """
    now = _now()
    anchor = getattr(org, "billing_cycle_anchor", None)
    if not anchor:
        return now + timedelta(days=30)

    # Find next occurrence of the anchor day
    next_cycle = anchor.replace(
        year=now.year,
        month=now.month,
    )
    if next_cycle <= now:
        # Move to next month
        if now.month == 12:
            next_cycle = next_cycle.replace(year=now.year + 1, month=1)
        else:
            next_cycle = next_cycle.replace(month=now.month + 1)
    return next_cycle


def _start_client_transition_period(
    managing_org: Organization,
    db: Session,
) -> None:
    """
    When a manager is soft locked, all their client orgs get a 1-month
    transition period to subscribe or link to a new manager.
    """
    now = _now()
    transition_until = now + timedelta(days=TRANSITION_PERIOD_DAYS)

    client_orgs = db.query(Organization).filter(
        Organization.managed_by_org_id == managing_org.id
    ).all()

    for client in client_orgs:
        client.transition_period_until = transition_until
        db.add(client)

        if client.is_ghost_client and client.contact_email:
            _send_ghost_client_transition_email(client, managing_org, transition_until)
        else:
            notify(
                db,
                org_id=client.id,
                type="manager_account_locked",
                title="Your energy manager's account is no longer active",
                body=(
                    f"You have until {transition_until.strftime('%d %b %Y')} to "
                    "subscribe to a CEI plan or link to a new energy manager. "
                    "Your data remains safe and accessible."
                ),
                extra={
                    "title_it": "L'account del tuo gestore energetico non è più attivo",
                    "body_it": (
                        f"Hai tempo fino al {transition_until.strftime('%d/%m/%Y')} per "
                        "iscriverti a un piano CEI o collegarti a un nuovo gestore energetico. "
                        "I tuoi dati rimangono al sicuro e accessibili."
                    ),
                    "url": "/account",
                },
            )

    logger.info(
        "Started transition period for %s client orgs under managing_org_id=%s until %s",
        len(client_orgs), managing_org.id, transition_until,
    )


def _send_grace_period_notification(
    org: Organization,
    db: Session,
    week: int,
) -> None:
    """Send weekly payment reminder during grace period."""
    days_left = (
        (org.grace_period_until - _now()).days
        if org.grace_period_until else 0
    )
    notify(
        db,
        org_id=org.id,
        type="payment_overdue",
        title=f"Payment overdue — {days_left} days remaining",
        body=(
            f"Week {week} of 4: Your payment is overdue. You have {days_left} days "
            "before your account is locked. Please update your payment method."
        ),
        extra={
            "title_it": f"Pagamento scaduto — {days_left} giorni rimanenti",
            "body_it": (
                f"Settimana {week} di 4: Il tuo pagamento è scaduto. Hai {days_left} giorni "
                "prima che il tuo account venga bloccato. Aggiorna il metodo di pagamento."
            ),
            "url": "/account",
            "week": week,
            "days_left": days_left,
        },
    )


def _pause_stripe_subscription(org: Organization) -> None:
    """Pause Stripe subscription. Best-effort — never raises."""
    try:
        sub_id = getattr(org, "stripe_subscription_id", None)
        if not sub_id:
            return
        import stripe  # type: ignore
        stripe.Subscription.modify(
            sub_id,
            pause_collection={"behavior": "void"},
        )
        logger.info("Paused Stripe subscription %s for org_id=%s", sub_id, org.id)
    except Exception:
        logger.exception("Failed to pause Stripe subscription for org_id=%s", org.id)


def _resume_stripe_subscription(org: Organization) -> None:
    """Resume Stripe subscription. Best-effort — never raises."""
    try:
        sub_id = getattr(org, "stripe_subscription_id", None)
        if not sub_id:
            return
        import stripe  # type: ignore
        stripe.Subscription.modify(
            sub_id,
            pause_collection="",
        )
        logger.info("Resumed Stripe subscription %s for org_id=%s", sub_id, org.id)
    except Exception:
        logger.exception("Failed to resume Stripe subscription for org_id=%s", org.id)


def _send_ghost_client_transition_email(
    org: Organization,
    managing_org: Organization,
    transition_until: datetime,
) -> None:
    """Send transition notification email to ghost client contact email."""
    try:
        from app.core.email import send_email
        send_email(
            to=org.contact_email,
            subject="Your energy monitoring account — action required",
            body=(
                f"Your energy monitoring through {managing_org.name} is no longer active.\n\n"
                f"You have until {transition_until.strftime('%d %b %Y')} to create a CEI "
                "account or link to a new energy manager to keep your data accessible.\n\n"
                "Visit carbonefficiencyintel.com to get started.\n\n"
                "Carbon Efficiency Intelligence"
            ),
        )
    except Exception:
        logger.exception(
            "Failed to send ghost client transition email to %s", org.contact_email
        )


def _send_ghost_client_lockout_email(org: Organization) -> None:
    """Send lockout notification email to ghost client contact email."""
    try:
        from app.core.email import send_email
        send_email(
            to=org.contact_email,
            subject="Your energy monitoring access has expired",
            body=(
                "Your transition period has ended and your energy monitoring access "
                "is now in read-only mode.\n\n"
                "To restore full access, create a CEI account at carbonefficiencyintel.com "
                "or contact a certified energy manager.\n\n"
                "Carbon Efficiency Intelligence"
            ),
        )
    except Exception:
        logger.exception(
            "Failed to send ghost client lockout email to %s", org.contact_email
        )
