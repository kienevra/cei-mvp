# backend/app/services/trial_service.py
"""
CEI Free Trial Service
----------------------
Manages the 30-day free trial for new organizations.

Rules:
- All new orgs get 30 days free (no card required)
- Day 28: first reminder email
- Day 29: second reminder email
- Day 30: final warning email
- Day 31+: soft lock if no active subscription
- Orgs with active Stripe subscription are exempt from soft lock

APScheduler job: run_trial_check_job() — daily at 08:00 UTC
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import List

from sqlalchemy.orm import Session

logger = logging.getLogger("cei.trial")

TRIAL_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _has_active_subscription(org) -> bool:
    """Check if org has an active Stripe subscription."""
    status = getattr(org, "subscription_status", None)
    return status in ("active", "trialing")


def _get_trial_recipients(org, db: Session) -> List[str]:
    """Get email recipients for trial notifications."""
    from app.models import User
    billing = getattr(org, "billing_email", None)
    if billing and "@" in str(billing):
        return [billing.strip()]
    owners = db.query(User).filter(
        User.organization_id == org.id,
        User.role == "owner",
        User.is_active == True,
    ).all()
    return [u.email for u in owners if u.email]


def _send_trial_email(
    to_email: str,
    org_name: str,
    days_left: int,
    lang: str = "it",
) -> None:
    """Send trial reminder email."""
    from app.core.email import send_email
    from app.core.config import settings

    app_url = (settings.frontend_url or "https://app.carbonefficiencyintel.com").rstrip("/")
    billing_url = f"{app_url}/billing"

    if days_left <= 0:
        if lang == "it":
            subject = "Il tuo periodo di prova CEI è scaduto"
            body_text = (
                f"Il periodo di prova gratuito di 30 giorni per {org_name} è scaduto.\n\n"
                "Il tuo account è ora in modalità sola lettura.\n\n"
                "Iscriviti a un piano CEI per ripristinare l'accesso completo:\n"
                f"{billing_url}\n\n"
                "Il team CEI"
            )
            cta = "Scegli un piano"
            headline = "Il tuo periodo di prova è scaduto"
            body_html = f"Il periodo di prova gratuito di 30 giorni per <strong>{org_name}</strong> è scaduto. Il tuo account è ora in modalità sola lettura."
        else:
            subject = "Your CEI free trial has expired"
            body_text = (
                f"Your 30-day free trial for {org_name} has expired.\n\n"
                "Your account is now in read-only mode.\n\n"
                "Subscribe to a CEI plan to restore full access:\n"
                f"{billing_url}\n\n"
                "The CEI Team"
            )
            cta = "Choose a plan"
            headline = "Your free trial has expired"
            body_html = f"Your 30-day free trial for <strong>{org_name}</strong> has expired. Your account is now in read-only mode."
        urgency_color = "#ef4444"
    elif days_left == 1:
        if lang == "it":
            subject = "⚠️ Il tuo periodo di prova CEI scade domani"
            body_text = (
                f"Il periodo di prova gratuito di {org_name} scade domani.\n\n"
                "Iscriviti oggi per non perdere l'accesso:\n"
                f"{billing_url}\n\n"
                "Il team CEI"
            )
            cta = "Iscriviti ora"
            headline = "Il tuo periodo di prova scade domani"
            body_html = f"Il periodo di prova gratuito di <strong>{org_name}</strong> scade <strong>domani</strong>. Iscriviti oggi per mantenere l'accesso completo."
        else:
            subject = "⚠️ Your CEI free trial expires tomorrow"
            body_text = (
                f"Your free trial for {org_name} expires tomorrow.\n\n"
                "Subscribe today to keep your access:\n"
                f"{billing_url}\n\n"
                "The CEI Team"
            )
            cta = "Subscribe now"
            headline = "Your free trial expires tomorrow"
            body_html = f"Your free trial for <strong>{org_name}</strong> expires <strong>tomorrow</strong>. Subscribe today to keep full access."
        urgency_color = "#f59e0b"
    else:
        if lang == "it":
            subject = f"Il tuo periodo di prova CEI scade tra {days_left} giorni"
            body_text = (
                f"Il periodo di prova gratuito di {org_name} scade tra {days_left} giorni.\n\n"
                "Iscriviti a un piano CEI per continuare senza interruzioni:\n"
                f"{billing_url}\n\n"
                "Il team CEI"
            )
            cta = "Scegli un piano"
            headline = f"Il tuo periodo di prova scade tra {days_left} giorni"
            body_html = f"Il periodo di prova gratuito di <strong>{org_name}</strong> scade tra <strong>{days_left} giorni</strong>."
        else:
            subject = f"Your CEI free trial expires in {days_left} days"
            body_text = (
                f"Your free trial for {org_name} expires in {days_left} days.\n\n"
                "Subscribe to a CEI plan to continue without interruption:\n"
                f"{billing_url}\n\n"
                "The CEI Team"
            )
            cta = "Choose a plan"
            headline = f"Your free trial expires in {days_left} days"
            body_html = f"Your free trial for <strong>{org_name}</strong> expires in <strong>{days_left} days</strong>."
        urgency_color = "#22c55e"

    html = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
        <tr><td style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px 32px;">
          <span style="color:#0f172a;font-size:18px;font-weight:700;">CEI</span>
          <span style="color:#0f172a;font-size:13px;margin-left:8px;opacity:0.8;">Carbon Efficiency Intelligence</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;color:#f1f5f9;font-size:18px;">{headline}</h2>
          <p style="margin:0 0 24px;color:#cbd5e1;font-size:14px;line-height:1.7;">{body_html}</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td style="background:{urgency_color};border-radius:6px;">
                <a href="{billing_url}"
                   style="display:inline-block;padding:13px 28px;color:#0f172a;
                          font-size:14px;font-weight:700;text-decoration:none;">
                  {cta} →
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0;font-size:13px;color:#64748b;">
            {'Piano CEI Starter da €89/mese · Piano Manager da €149/mese' if lang == 'it' else 'CEI Starter from €89/month · Manager plan from €149/month'}
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;">
          <p style="margin:0;font-size:11px;color:#475569;">
            © 2026 Carbon Efficiency Intelligence ·
            <a href="{app_url}" style="color:#22c55e;text-decoration:none;">carbonefficiencyintel.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    send_email(
        to_email=to_email,
        subject=subject,
        text_body=body_text,
        html_body=html,
    )


def check_trials(db: Session) -> None:
    """
    Main trial check function. Called daily at 08:00 UTC.
    - Sends reminder emails at days 28, 29, 30
    - Soft locks orgs that are past trial and have no active subscription
    """
    from app.models import Organization

    now = _now()

    # Find orgs with trial_ends_at set
    orgs = db.query(Organization).filter(
        Organization.trial_ends_at.isnot(None),
        Organization.soft_locked == False,
    ).all()

    logger.info("Trial check: %s orgs with active trials", len(orgs))

    for org in orgs:
        try:
            trial_ends = org.trial_ends_at
            if trial_ends.tzinfo is None:
                trial_ends = trial_ends.replace(tzinfo=timezone.utc)

            days_left = (trial_ends - now).days
            has_sub = _has_active_subscription(org)

            # Already subscribed — skip
            if has_sub:
                continue

            # Send reminder at days 28, 29, 30 (i.e. 2, 1, 0 days left)
            if days_left in (2, 1, 0):
                recipients = _get_trial_recipients(org, db)
                lang = "it"  # default Italian for CEI market
                for email in recipients:
                    try:
                        _send_trial_email(
                            to_email=email,
                            org_name=org.name,
                            days_left=days_left,
                            lang=lang,
                        )
                        logger.info(
                            "Trial reminder sent to %s for org_id=%s (days_left=%s)",
                            email, org.id, days_left,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to send trial reminder to %s for org_id=%s",
                            email, org.id,
                        )

            # Soft lock if trial expired and no subscription
            if days_left < 0 and not has_sub:
                org.soft_locked = True
                org.soft_locked_at = now
                org.subscription_status = "trial_expired"
                db.add(org)
                db.commit()

                # Send expiry email
                recipients = _get_trial_recipients(org, db)
                for email in recipients:
                    try:
                        _send_trial_email(
                            to_email=email,
                            org_name=org.name,
                            days_left=0,
                            lang="it",
                        )
                    except Exception:
                        logger.exception(
                            "Failed to send trial expiry email to %s for org_id=%s",
                            email, org.id,
                        )

                logger.info(
                    "Trial expired — soft locked org_id=%s (%s)",
                    org.id, org.name,
                )

        except Exception:
            logger.exception("Trial check failed for org_id=%s", org.id)


def run_trial_check_job() -> None:
    """APScheduler entrypoint — creates its own DB session."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        check_trials(db)
    except Exception:
        logger.exception("run_trial_check_job failed")
    finally:
        db.close()