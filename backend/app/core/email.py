# backend/app/core/email.py
from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Optional

from app.core.config import settings


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.getenv(name, default)
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def send_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
) -> None:
    """
    Email sending strategy:
      - In dev/non-prod: print to logs (safe + no dependency).
      - In prod: use SMTP if configured.

    Required env vars for SMTP mode:
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
    Optional:
      SMTP_USE_TLS=true|false (default true)
    """
    to_email = (to_email or "").strip()
    if not to_email:
        return

    is_prod = bool(getattr(settings, "is_prod", False))
    debug = bool(getattr(settings, "debug", True))

    smtp_host = _env("SMTP_HOST")
    smtp_port = int(_env("SMTP_PORT", "587") or "587")
    smtp_user = _env("SMTP_USER")
    smtp_password = _env("SMTP_PASSWORD")
    smtp_from = _env("SMTP_FROM") or "no-reply@carbonefficiencyintel.com"
    use_tls = (_env("SMTP_USE_TLS", "true") or "true").lower() in {"1", "true", "yes", "y"}

    # Default: log to console in dev OR if SMTP not configured
    if (not is_prod) or debug or (not smtp_host) or (not smtp_user) or (not smtp_password):
        print("=== CEI EMAIL (dev/log mode) ===")
        print("To:", to_email)
        print("Subject:", subject)
        print(text_body)
        if html_body:
            print("--- HTML ---")
            print(html_body)
        print("=== /CEI EMAIL ===")
        return

    msg = EmailMessage()
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text_body)

    if html_body:
        msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
        if use_tls:
            server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(msg)
