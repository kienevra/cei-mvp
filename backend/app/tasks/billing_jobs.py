# backend/app/tasks/billing_jobs.py
"""
CEI Billing Jobs — APScheduler daily tasks
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models import Organization

logger = logging.getLogger("cei.billing_jobs")

def _now() -> datetime:
    return datetime.now(timezone.utc)

def run_billing_cycle_checks() -> None:
    logger.info("Billing cycle checks starting")
    db: Session = SessionLocal()
    try:
        _apply_pending_suspensions(db)
        _apply_next_cycle_site_counts(db)
        _send_grace_notifications(db)
        _apply_expired_grace_locks(db)
        _apply_expired_transition_locks(db)
        _apply_expired_client_grace_locks(db)
    except Exception:
        logger.exception("Unexpected error in run_billing_cycle_checks")
    finally:
        db.close()
    logger.info("Billing cycle checks complete")

def _apply_pending_suspensions(db: Session) -> None:
    try:
        now = _now()
        orgs = db.query(Organization).filter(
            Organization.subscription_suspended == False,
            Organization.suspension_effective_date != None,
            Organization.suspension_effective_date <= now,
        ).all()
        for org in orgs:
            try:
                from app.services.billing_service import apply_subscription_suspension
                apply_subscription_suspension(org, db)
                db.commit()
                logger.info("Applied subscription suspension for org_id=%s", org.id)
            except Exception:
                db.rollback()
                logger.exception("Failed to apply suspension for org_id=%s", org.id)
    except Exception:
        logger.exception("Error in _apply_pending_suspensions")

def _apply_next_cycle_site_counts(db: Session) -> None:
    try:
        now = _now()
        orgs = db.query(Organization).filter(
            Organization.org_type == "managing",
            Organization.next_billing_site_count != None,
            Organization.billing_cycle_anchor != None,
            Organization.billing_cycle_anchor <= now,
        ).all()
        for org in orgs:
            try:
                from app.services.billing_service import apply_next_cycle_site_count, sync_stripe_site_quantity
                apply_next_cycle_site_count(org, db)
                sync_stripe_site_quantity(org, db)
                anchor = org.billing_cycle_anchor
                if anchor.month == 12:
                    org.billing_cycle_anchor = anchor.replace(year=anchor.year + 1, month=1)
                else:
                    org.billing_cycle_anchor = anchor.replace(month=anchor.month + 1)
                db.add(org)
                db.commit()
                logger.info("Applied next cycle site count for org_id=%s: %s sites", org.id, org.billed_site_count)
            except Exception:
                db.rollback()
                logger.exception("Failed to apply next cycle site count for org_id=%s", org.id)
    except Exception:
        logger.exception("Error in _apply_next_cycle_site_counts")

def _send_grace_notifications(db: Session) -> None:
    try:
        now = _now()
        orgs = db.query(Organization).filter(
            Organization.grace_period_until != None,
            Organization.grace_period_until > now,
        ).all()
        for org in orgs:
            try:
                from app.services.billing_service import check_and_send_grace_notifications
                check_and_send_grace_notifications(org, db)
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Failed to send grace notification for org_id=%s", org.id)
    except Exception:
        logger.exception("Error in _send_grace_notifications")

def _apply_expired_grace_locks(db: Session) -> None:
    try:
        now = _now()
        orgs = db.query(Organization).filter(
            Organization.grace_period_until != None,
            Organization.grace_period_until <= now,
            Organization.soft_locked == False,
        ).all()
        for org in orgs:
            try:
                from app.services.billing_service import apply_soft_lock
                apply_soft_lock(org, db)
                db.commit()
                logger.info("Soft lock applied (expired grace) for org_id=%s", org.id)
            except Exception:
                db.rollback()
                logger.exception("Failed to apply soft lock for org_id=%s", org.id)
    except Exception:
        logger.exception("Error in _apply_expired_grace_locks")

def _apply_expired_transition_locks(db: Session) -> None:
    try:
        now = _now()
        orgs = db.query(Organization).filter(
            Organization.transition_period_until != None,
            Organization.transition_period_until <= now,
            Organization.soft_locked == False,
        ).all()
        for org in orgs:
            try:
                from app.services.billing_service import apply_client_soft_lock_after_transition
                apply_client_soft_lock_after_transition(org, db)
                db.commit()
                logger.info("Soft lock applied (expired transition) for org_id=%s", org.id)
            except Exception:
                db.rollback()
                logger.exception("Failed to apply transition soft lock for org_id=%s", org.id)
    except Exception:
        logger.exception("Error in _apply_expired_transition_locks")

def _apply_expired_client_grace_locks(db: Session) -> None:
    try:
        now = _now()
        orgs = db.query(Organization).filter(
            Organization.client_grace_until != None,
            Organization.client_grace_until <= now,
            Organization.soft_locked == False,
            Organization.managed_by_org_id == None,
            Organization.subscription_status != "active",
        ).all()
        for org in orgs:
            try:
                org.client_grace_until = None
                from app.services.billing_service import apply_soft_lock
                apply_soft_lock(org, db)
                db.commit()
                logger.info("Soft lock applied (expired client grace) for org_id=%s", org.id)
            except Exception:
                db.rollback()
                logger.exception("Failed to apply client grace soft lock for org_id=%s", org.id)
    except Exception:
        logger.exception("Error in _apply_expired_client_grace_locks")