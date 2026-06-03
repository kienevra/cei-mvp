# backend/app/services/digest_email.py
"""
Daily Digest Email Service
--------------------------
Sends a morning energy digest to all orgs with enable_notification_emails=True.
Scheduled at 07:00 UTC via APScheduler (registered in main.py).

Digest content per org:
  1. Alert summary  — counts by severity + top 5 from last 24h
  2. KPI snapshot   — total portfolio kWh + deviation vs 7-day daily average
  3. Top focus site — site with most alerts + its top opportunity if available

Uses app.core.email (Resend) for delivery.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger("cei.digest")


# ─── Email send helper ────────────────────────────────────────────────────────

def _send(to_email: str, subject: str, html: str) -> bool:
    try:
        from app.core.email import send_email  # type: ignore
        send_email(
            to_email=to_email,
            subject=subject,
            text_body=subject,  # plain text fallback
            html_body=html,
        )
        return True
    except Exception:
        logger.exception("Failed to send digest to %s", to_email)
        return False


# ─── Data helpers ─────────────────────────────────────────────────────────────

def _get_org_emails(org) -> List[str]:
    """Return the billing email or owner email for an org."""
    emails = []
    billing = getattr(org, "billing_email", None)
    if billing and isinstance(billing, str) and "@" in billing:
        emails.append(billing.strip())
    return emails


def _get_site_ids(db: Session, org_id: int) -> List[int]:
    from app.models import Site
    rows = db.query(Site.id).filter(Site.org_id == org_id).all()
    return [r[0] for r in rows if r[0] is not None]


def _kpi_snapshot(db: Session, org_id: int):
    """Returns (kwh_24h, kwh_7d_daily_avg, deviation_pct)."""
    from app.models import TimeseriesRecord

    now = datetime.now(timezone.utc)
    start_24h = now - timedelta(hours=24)
    start_7d  = now - timedelta(days=7)

    kwh_24h = float(
        db.query(func.sum(TimeseriesRecord.value))
        .filter(
            TimeseriesRecord.organization_id == org_id,
            TimeseriesRecord.timestamp >= start_24h,
        )
        .scalar() or 0.0
    )

    kwh_7d = float(
        db.query(func.sum(TimeseriesRecord.value))
        .filter(
            TimeseriesRecord.organization_id == org_id,
            TimeseriesRecord.timestamp >= start_7d,
            TimeseriesRecord.timestamp < start_24h,
        )
        .scalar() or 0.0
    )

    daily_avg_7d = kwh_7d / 6.0 if kwh_7d > 0 else 0.0  # 6 prior days

    deviation_pct: Optional[float] = None
    if daily_avg_7d > 0:
        deviation_pct = ((kwh_24h - daily_avg_7d) / daily_avg_7d) * 100.0

    return kwh_24h, daily_avg_7d, deviation_pct


def _get_recent_alerts(db: Session, org_id: int, hours: int = 24):
    from app.models import AlertEvent

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return (
        db.query(AlertEvent)
        .filter(
            AlertEvent.organization_id == org_id,
            AlertEvent.triggered_at >= since,
        )
        .order_by(AlertEvent.triggered_at.desc())
        .all()
    )


def _top_site_by_alerts(alerts) -> Optional[str]:
    from collections import Counter
    if not alerts:
        return None
    counts = Counter(a.site_id for a in alerts if a.site_id)
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def _get_top_opportunity(db: Session, site_ids: List[int]):
    """Return the most recently created opportunity across the org's sites."""
    from app.models import Opportunity
    if not site_ids:
        return None
    return (
        db.query(Opportunity)
        .filter(Opportunity.site_id.in_(site_ids))
        .order_by(Opportunity.created_at.desc())
        .first()
    )


# ─── HTML email builder ───────────────────────────────────────────────────────

def _fmt_kwh(v: float) -> str:
    if v >= 1_000_000:
        return f"{v/1_000_000:.2f} GWh"
    if v >= 1000:
        return f"{v/1000:.2f} MWh"
    return f"{v:.1f} kWh"


def _severity_color(sev: str) -> str:
    return {"critical": "#f87171", "warning": "#fb923c", "info": "#38bdf8"}.get(sev, "#9ca3af")


def _severity_icon(sev: str) -> str:
    return {"critical": "🔴", "warning": "⚠️", "info": "ℹ️"}.get(sev, "•")


def _build_digest_html(
    org_name: str,
    date_str: str,
    alerts,
    kwh_24h: float,
    daily_avg_7d: float,
    deviation_pct: Optional[float],
    top_site: Optional[str],
    top_opp,
    app_url: str,
    currency_code: str,
) -> str:

    # ── Alert rows ──
    critical_count = sum(1 for a in alerts if a.severity == "critical")
    warning_count  = sum(1 for a in alerts if a.severity == "warning")
    info_count     = sum(1 for a in alerts if a.severity == "info")
    total_alerts   = len(alerts)

    alert_rows = ""
    for a in alerts[:5]:
        icon  = _severity_icon(a.severity)
        color = _severity_color(a.severity)
        site  = a.site_id or "—"
        title = a.title or "Alert"
        ts    = a.triggered_at.strftime("%H:%M") if a.triggered_at else "—"
        alert_rows += f"""
        <tr>
          <td style="padding:8px 0; border-bottom:1px solid #1e293b; vertical-align:top;">
            <span style="color:{color}; font-size:13px;">{icon} <strong>{title}</strong></span><br>
            <span style="color:#64748b; font-size:12px;">{site} · {ts}</span>
          </td>
        </tr>"""

    if not alert_rows:
        alert_rows = """
        <tr><td style="padding:12px 0; color:#22c55e; font-size:13px;">
          ✓ No alerts in the last 24 hours — fleet running clean.
        </td></tr>"""

    # ── KPI deviation badge ──
    if deviation_pct is not None:
        sign  = "+" if deviation_pct >= 0 else ""
        dcolor = "#f87171" if deviation_pct > 10 else "#22c55e" if deviation_pct < -10 else "#9ca3af"
        dev_badge = f'<span style="color:{dcolor}; font-weight:700;">{sign}{deviation_pct:.1f}% vs 7-day avg</span>'
    else:
        dev_badge = '<span style="color:#64748b;">Baseline not yet available</span>'

    avg_str = f"7-day daily avg: {_fmt_kwh(daily_avg_7d)}" if daily_avg_7d > 0 else ""

    # ── Opportunity block ──
    opp_block = ""
    if top_opp:
        opp_block = f"""
      <tr><td style="padding:20px 0 0;">
        <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#e2e8f0;">
          🎯 Top focus
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:16px;">
            <p style="margin:0 0 6px; font-size:14px; font-weight:700; color:#38bdf8;">
              {top_opp.name or "Efficiency opportunity"}
            </p>
            <p style="margin:0; font-size:13px; color:#94a3b8;">
              {top_opp.description or "Review this site for potential energy savings."}
            </p>
          </td></tr>
        </table>
      </td></tr>"""
    elif top_site:
        opp_block = f"""
      <tr><td style="padding:20px 0 0;">
        <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#e2e8f0;">
          🎯 Priority site today
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:16px;">
            <p style="margin:0 0 6px; font-size:14px; font-weight:700; color:#fb923c;">
              {top_site}
            </p>
            <p style="margin:0; font-size:13px; color:#94a3b8;">
              This site generated the most alerts in the last 24 hours.
              Review the site dashboard and check the Opportunities tab.
            </p>
          </td></tr>
        </table>
      </td></tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CEI Daily Digest — {date_str}</title>
</head>
<body style="margin:0; padding:0; background:#020617; font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;">
    <tr><td align="center" style="padding:32px 16px;">

      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#082f49,#020617); border-radius:12px 12px 0 0; padding:28px 32px; border:1px solid #1e293b; border-bottom:none;">
          <p style="margin:0 0 4px; font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:#38bdf8;">
            Carbon Efficiency Intelligence
          </p>
          <h1 style="margin:0 0 6px; font-size:22px; font-weight:700; color:#f1f5f9; letter-spacing:-0.02em;">
            Daily Digest
          </h1>
          <p style="margin:0; font-size:13px; color:#64748b;">
            {date_str} · {org_name}
          </p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#0a1628; border:1px solid #1e293b; border-top:none; border-bottom:none; padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">

            <!-- Alert summary pills -->
            <tr><td style="padding-bottom:20px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:8px;">
                    <span style="display:inline-block; padding:4px 12px; border-radius:999px; background:rgba(248,113,113,0.12); border:1px solid rgba(248,113,113,0.3); color:#f87171; font-size:12px; font-weight:700;">
                      🔴 {critical_count} Critical
                    </span>
                  </td>
                  <td style="padding-right:8px;">
                    <span style="display:inline-block; padding:4px 12px; border-radius:999px; background:rgba(251,146,60,0.12); border:1px solid rgba(251,146,60,0.3); color:#fb923c; font-size:12px; font-weight:700;">
                      ⚠️ {warning_count} Warning
                    </span>
                  </td>
                  <td>
                    <span style="display:inline-block; padding:4px 12px; border-radius:999px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.2); color:#38bdf8; font-size:12px; font-weight:700;">
                      ℹ️ {info_count} Info
                    </span>
                  </td>
                </tr>
              </table>
            </td></tr>

            <!-- Alerts section -->
            <tr><td>
              <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#e2e8f0;">
                🚨 Alerts — last 24h
                <span style="font-size:12px; font-weight:400; color:#64748b; margin-left:8px;">
                  {total_alerts} total
                </span>
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                {alert_rows}
              </table>
            </td></tr>

            <!-- KPI snapshot -->
            <tr><td style="padding-top:24px;">
              <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#e2e8f0;">
                ⚡ Portfolio KPI
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:16px; width:50%;">
                    <p style="margin:0 0 4px; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#64748b;">Last 24h</p>
                    <p style="margin:0; font-size:22px; font-weight:700; color:#38bdf8;">{_fmt_kwh(kwh_24h)}</p>
                    <p style="margin:4px 0 0; font-size:12px;">{dev_badge}</p>
                    <p style="margin:2px 0 0; font-size:11px; color:#475569;">{avg_str}</p>
                  </td>
                </tr>
              </table>
            </td></tr>

            {opp_block}

          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="background:#0a1628; border:1px solid #1e293b; border-top:1px solid #1e293b; padding:20px 32px; text-align:center;">
          <a href="{app_url}/alerts"
             style="display:inline-block; padding:12px 28px; border-radius:999px; background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; font-size:14px; font-weight:700; text-decoration:none; letter-spacing:0.01em;">
            View Dashboard →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#020617; border-radius:0 0 12px 12px; border:1px solid #1e293b; border-top:none; padding:16px 32px; text-align:center;">
          <p style="margin:0; font-size:11px; color:#334155;">
            CEI · Carbon Efficiency Intelligence ·
            <a href="{app_url}/settings" style="color:#38bdf8; text-decoration:none;">Manage notifications</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ─── Main digest sender ───────────────────────────────────────────────────────

def send_daily_digest(db: Session) -> None:
    """
    Send the daily digest to all eligible orgs.
    Called by the APScheduler job at 07:00 UTC.
    """
    from app.models import Organization, User
    from app.core.config import settings

    app_url = (settings.frontend_url or "https://app.carbonefficiencyintel.com").rstrip("/")
    date_str = datetime.now(timezone.utc).strftime("%A, %d %B %Y")

    # Load orgs with email notifications enabled
    orgs = (
        db.query(Organization)
        .filter(Organization.enable_notification_emails == True)  # noqa: E712
        .all()
    )

    logger.info("Daily digest: %s eligible orgs", len(orgs))
    sent = 0

    for org in orgs:
        try:
            # Resolve recipient email(s)
            emails = _get_org_emails(org)

            # Fall back to org owner's email if no billing email set
            if not emails:
                owner = (
                    db.query(User)
                    .filter(
                        User.organization_id == org.id,
                        User.role == "owner",
                        User.is_active == True,
                    )
                    .first()
                )
                if owner and owner.email:
                    emails = [owner.email]

            if not emails:
                logger.info("Digest: no email found for org_id=%s, skipping", org.id)
                continue

            # Gather data
            site_ids      = _get_site_ids(db, org.id)
            alerts        = _get_recent_alerts(db, org.id, hours=24)
            kwh_24h, avg_7d, dev_pct = _kpi_snapshot(db, org.id)
            top_site      = _top_site_by_alerts(alerts)
            top_opp       = _get_top_opportunity(db, site_ids)
            currency      = getattr(org, "currency_code", None) or "EUR"

            html = _build_digest_html(
                org_name     = org.name,
                date_str     = date_str,
                alerts       = alerts,
                kwh_24h      = kwh_24h,
                daily_avg_7d = avg_7d,
                deviation_pct= dev_pct,
                top_site     = top_site,
                top_opp      = top_opp,
                app_url      = app_url,
                currency_code= currency,
            )

            subject = (
                f"CEI Daily Digest — {date_str} | "
                f"{len(alerts)} alert{'s' if len(alerts) != 1 else ''}"
            )

            for email in emails:
                ok = _send(email, subject, html)
                if ok:
                    sent += 1
                    logger.info("Digest sent to %s (org_id=%s)", email, org.id)

        except Exception:
            logger.exception("Digest failed for org_id=%s", org.id)

    logger.info("Daily digest complete: %s emails sent", sent)


def send_daily_digest_job() -> None:
    """
    Entrypoint for APScheduler — creates its own DB session.
    """
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        send_daily_digest(db)
    except Exception:
        logger.exception("send_daily_digest_job failed")
    finally:
        db.close()

# ── Critical alert email ──────────────────────────────────────────────────────

def send_critical_alert_email(
    db: Session,
    org_id: int,
    severity: str,
    title: str,
    message: str,
    site_name: Optional[str],
    site_id: Optional[str],
) -> None:
    """
    Send a real-time email when a critical alert fires.
    Only sends if enable_notification_emails=True on the org.
    Recipients: org billing_email, then owner user emails.
    """
    from app.models import Organization, User
    from app.core.config import settings

    try:
        org = db.query(Organization).filter(Organization.id == org_id).first()
        if not org:
            return
        if not getattr(org, "enable_notification_emails", True):
            return

        app_url = (settings.frontend_url or "https://app.carbonefficiencyintel.com").rstrip("/")

        # Collect recipient emails
        recipients = []
        billing = getattr(org, "billing_email", None)
        if billing and "@" in billing:
            recipients.append(billing.strip())
        if not recipients:
            owners = (
                db.query(User)
                .filter(User.organization_id == org_id, User.role == "owner", User.is_active == True)
                .all()
            )
            recipients = [u.email for u in owners if u.email]

        if not recipients:
            logger.warning("send_critical_alert_email: no recipients for org %s", org_id)
            return

        severity_label = severity.upper()
        severity_color = "#ef4444" if severity == "critical" else "#f59e0b"
        site_label = site_name or site_id or "Unknown site"
        alerts_url = f"{app_url}/alerts"

        subject = f"[CEI {severity_label}] {title} — {site_label}"

        html = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:{severity_color};padding:20px 32px;">
          <span style="color:#fff;font-size:13px;font-weight:700;letter-spacing:0.05em;">
            CEI — {severity_label} ALERT
          </span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 8px;color:#f1f5f9;font-size:20px;">{title}</h2>
          <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;">Site: <strong style="color:#e2e8f0;">{site_label}</strong></p>
          <div style="background:#0f172a;border-radius:8px;padding:16px;margin-bottom:24px;">
            <p style="margin:0;color:#cbd5e1;font-size:14px;line-height:1.6;">{message}</p>
          </div>
          <a href="{alerts_url}" style="display:inline-block;padding:12px 24px;background:#22c55e;color:#0f172a;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none;">
            View in CEI →
          </a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px;border-top:1px solid rgba(148,163,184,0.1);">
          <p style="margin:0;color:#475569;font-size:12px;">
            CEI — Carbon Efficiency Intelligence · 
            <a href="{app_url}" style="color:#22c55e;text-decoration:none;">app.carbonefficiencyintel.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

        for email in recipients:
            _send(to_email=email, subject=subject, html=html)
            logger.info("Critical alert email sent to %s for org %s", email, org_id)

    except Exception:
        logger.exception("send_critical_alert_email failed for org %s", org_id)

# ── Welcome email with playbook attachment ────────────────────────────────────

def _detect_lang(accept_language: Optional[str]) -> str:
    """
    Detect language from Accept-Language header.
    Returns 'it' if Italian is preferred, otherwise 'en'.
    Defaults to 'it' (primary market is Italian manufacturing SMEs).
    """
    if not accept_language:
        return "it"
    # Parse Accept-Language: "it-IT,it;q=0.9,en;q=0.8"
    lang = accept_language.lower().split(",")[0].strip().split(";")[0].strip()
    if lang.startswith("it"):
        return "it"
    return "en"


def _get_playbook_attachment(org_type: str, lang: str) -> Optional[dict]:
    """
    Load the correct playbook file and return a Resend attachment dict.
    Returns None if the file cannot be found.
    """
    import base64
    import os

    # Map org_type + lang to filename
    filename_map = {
        ("managing", "en"): "CEI_Consultant_Playbook_EN_v2.docx",
        ("managing", "it"): "CEI_Manuale_Consulenti_IT_v2.docx",
        ("standalone", "en"): "CEI_Organization_Playbook_EN_v2.docx",
        ("standalone", "it"): "CEI_Manuale_Organizzazioni_IT_v2.docx",
        ("client", "en"): "CEI_Organization_Playbook_EN_v2.docx",
        ("client", "it"): "CEI_Manuale_Organizzazioni_IT_v2.docx",
    }

    filename = filename_map.get((org_type, lang)) or filename_map.get(("standalone", lang), "CEI_Organization_Playbook_EN_v2.docx")

    # Path relative to this file: backend/app/static/playbooks/
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    filepath = os.path.join(base_dir, "static", "playbooks", filename)

    if not os.path.exists(filepath):
        logger.warning("Welcome email: playbook file not found at %s", filepath)
        return None

    try:
        with open(filepath, "rb") as f:
            content = base64.b64encode(f.read()).decode("utf-8")
        return {
            "filename": filename,
            "content": content,
        }
    except Exception as exc:
        logger.warning("Welcome email: failed to read playbook %s: %s", filepath, exc)
        return None


def send_welcome_email(
    to_email: str,
    org_name: str,
    org_type: str,
    accept_language: Optional[str] = None,
    full_name: Optional[str] = None,
) -> None:
    """
    Send a personalised welcome email to a new org owner with the appropriate
    playbook attached.

    Called immediately after successful signup in auth.py.
    Best-effort — never raises, never blocks signup.
    """
    from app.core.config import settings

    try:
        lang = _detect_lang(accept_language)
        app_url = (settings.frontend_url or "https://app.carbonefficiencyintel.com").rstrip("/")

        # ── Personalisation ───────────────────────────────────────────────────
        # Use first name if available, fall back to org name
        first_name = None
        if full_name and full_name.strip():
            first_name = full_name.strip().split()[0]

        if lang == "it":
            greeting_name = first_name or org_name
            greeting = f"Salve {greeting_name},"
            subject = "Benvenuto in CEI — Carbon Efficiency Intelligence"
            body = (
                "Voglio darle il benvenuto personalmente in CEI. "
                "La sua dashboard è attiva. "
                "In allegato trova il manuale completo sulla piattaforma e le sue funzionalità."
            )
            contact_line = "Per qualsiasi problema non esiti a contattarci all'indirizzo"
            regards = "Cordiali saluti,"
            founder_title = "Fondatore: CEI — Carbon Efficiency Intelligence"
        else:
            greeting_name = first_name or org_name
            greeting = f"Hello {greeting_name},"
            subject = "Welcome to CEI — Carbon Efficiency Intelligence"
            body = (
                "I want to personally welcome you to CEI. "
                "Your dashboard is live. "
                "Attached to this email is a manual on how to use the platform and its various functionalities."
            )
            contact_line = "If you ever run into any problems feel free to contact us at"
            regards = "Kind regards,"
            founder_title = "Fondatore: CEI — Carbon Efficiency Intelligence"

        support_email = "support@carbonefficiencyintel.com"
        site_url = "https://carbonefficiencyintel.com"

        # ── Plain-text fallback ───────────────────────────────────────────────
        text_body = (
            f"{greeting}\n\n"
            f"{body}\n\n"
            f"{contact_line} {support_email}\n\n"
            f"{regards}\n"
            f"Leon Miriti\n"
            f"{founder_title}\n"
            f"{site_url}\n"
        )

        # ── HTML body ─────────────────────────────────────────────────────────
        html_body = f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#020617;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0"
             style="background:#0a1628;border-radius:12px;overflow:hidden;border:1px solid #1e293b;max-width:580px;width:100%;">

        <!-- Header bar -->
        <tr>
          <td style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:28px 40px;">
            <span style="color:#0f172a;font-size:20px;font-weight:700;letter-spacing:0.05em;">CEI</span>
            <span style="color:#0f172a;font-size:13px;margin-left:8px;opacity:0.8;">Carbon Efficiency Intelligence</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">

            <p style="margin:0 0 20px;font-size:16px;color:#f1f5f9;font-weight:400;line-height:1.5;">
              {greeting}
            </p>

            <p style="margin:0 0 20px;font-size:15px;color:#cbd5e1;line-height:1.7;">
              {body}
            </p>

            <p style="margin:0 0 32px;font-size:15px;color:#cbd5e1;line-height:1.7;">
              {contact_line}
              <a href="mailto:{support_email}"
                 style="color:#22c55e;font-weight:600;text-decoration:none;">
                {support_email}
              </a>.
            </p>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 40px;">
              <tr>
                <td style="background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:6px;">
                  <a href="{app_url}"
                     style="display:inline-block;padding:13px 28px;color:#0f172a;
                            font-size:14px;font-weight:700;text-decoration:none;
                            letter-spacing:0.01em;">
                    {"Accedi alla piattaforma" if lang == "it" else "Access your dashboard"} →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Signature -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-top:1px solid #1e293b;padding-top:24px;">
                  <p style="margin:0 0 4px;font-size:14px;color:#94a3b8;">{regards}</p>
                  <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#f1f5f9;">Leon Miriti</p>
                  <p style="margin:0 0 2px;font-size:13px;color:#64748b;">{founder_title}</p>
                  <p style="margin:0;font-size:13px;">
                    <a href="{site_url}" style="color:#22c55e;text-decoration:none;">
                      carbonefficiencyintel.com
                    </a>
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#020617;padding:16px 40px;border-top:1px solid #1e293b;">
            <p style="margin:0;font-size:11px;color:#334155;">
              © 2026 Carbon Efficiency Intelligence ·
              <a href="{app_url}/account" style="color:#334155;">{"Gestisci notifiche" if lang == "it" else "Manage notifications"}</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

        # ── Attachment ────────────────────────────────────────────────────────
        attachment = _get_playbook_attachment(org_type, lang)
        attachments = [attachment] if attachment else None

        # ── Send ──────────────────────────────────────────────────────────────
        from app.core.email import send_email
        send_email(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            attachments=attachments,
        )

        logger.info(
            "Welcome email sent to %s org_type=%s lang=%s attachment=%s",
            to_email, org_type, lang,
            attachments[0]["filename"] if attachments else "none",
        )

    except Exception:
        logger.exception("send_welcome_email failed for %s", to_email)