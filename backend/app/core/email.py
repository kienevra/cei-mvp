# backend/app/core/email.py
from __future__ import annotations

import json
import logging
import os
import smtplib
import urllib.request
import urllib.error
from email.message import EmailMessage
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("cei")


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.getenv(name, default)
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _truthy(v: Optional[str]) -> bool:
    if v is None:
        return False
    return str(v).strip().lower() in {"1", "true", "yes", "y", "on"}


def _send_resend(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str],
) -> None:
    """
    Send email via Resend REST API (no extra deps; uses urllib).
    Env/Settings:
      - EMAIL_FROM (settings.email_from)
      - RESEND_API_KEY (settings.resend_api_key or env RESEND_API_KEY)
    """
    api_key = getattr(settings, "resend_api_key", None) or _env("RESEND_API_KEY")
    from_email = getattr(settings, "email_from", None) or _env("EMAIL_FROM") or "CEI <no-reply@carbonefficiencyintel.com>"

    if not api_key:
        logger.warning("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set; falling back to log mode.")
        _log_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
        return

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "text": text_body,
    }
    if html_body:
        payload["html"] = html_body

    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url="https://api.resend.com/emails",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            # Read response for observability; not strictly needed
            _ = resp.read()
        logger.info("Email sent via Resend to=%s subject=%s", to_email, subject)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        logger.error("Resend HTTPError status=%s body=%s", getattr(e, "code", None), body)
    except Exception:
        logger.exception("Resend send failed")


def _send_smtp(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str],
) -> None:
    """
    SMTP mode (legacy/fallback).
    Required env vars:
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
    Optional:
      SMTP_FROM, SMTP_USE_TLS=true|false
    """
    smtp_host = _env("SMTP_HOST")
    smtp_port = int(_env("SMTP_PORT", "587") or "587")
    smtp_user = _env("SMTP_USER")
    smtp_password = _env("SMTP_PASSWORD")
    smtp_from = _env("SMTP_FROM") or getattr(settings, "email_from", None) or "no-reply@carbonefficiencyintel.com"
    use_tls = _truthy(_env("SMTP_USE_TLS", "true"))

    if (not smtp_host) or (not smtp_user) or (not smtp_password):
        logger.warning("SMTP email requested but SMTP_* env vars are not fully configured; falling back to log mode.")
        _log_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
        return

    msg = EmailMessage()
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text_body)

    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            if use_tls:
                server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(msg)
        logger.info("Email sent via SMTP to=%s subject=%s", to_email, subject)
    except Exception:
        logger.exception("SMTP send failed")


def _log_email(*, to_email: str, subject: str, text_body: str, html_body: Optional[str]) -> None:
    print("=== CEI EMAIL (log mode) ===")
    print("To:", to_email)
    print("Subject:", subject)
    print(text_body)
    if html_body:
        print("--- HTML ---")
        print(html_body)
    print("=== /CEI EMAIL ===")


def send_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
) -> None:
    """
    Unified email send.

    Provider selection:
      - EMAIL_PROVIDER=resend  -> Resend API
      - EMAIL_PROVIDER=smtp    -> SMTP using SMTP_* env vars
      - EMAIL_PROVIDER=log     -> print to logs

    Behavior:
      - Never raises (best-effort). Password reset should not 500 because email hiccuped.
      - In dev/debug: defaults to log mode unless explicitly configured.
    """
    to_email = (to_email or "").strip()
    if not to_email:
        return

    provider = (getattr(settings, "email_provider", None) or _env("EMAIL_PROVIDER") or "log").strip().lower()
    debug = bool(getattr(settings, "debug", True))
    is_prod = bool(getattr(settings, "is_prod", False))

    # If not prod and debug, default to log unless explicitly configured by env.
    if (not is_prod) and debug and provider == "log":
        _log_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
        return

    if provider == "resend":
        _send_resend(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
        return

    if provider == "smtp":
        _send_smtp(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
        return

    # Default safe fallback
    _log_email(to_email=to_email, subject=subject, text_body=text_body, html_body=html_body)
