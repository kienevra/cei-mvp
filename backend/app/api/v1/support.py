# backend/app/api/v1/support.py
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.session import get_db
from app.models import User

logger = logging.getLogger("cei")

router = APIRouter(prefix="/support", tags=["support"])


class SupportReportIn(BaseModel):
    category: Optional[str] = None
    subject: str
    description: str


@router.post("/report", status_code=status.HTTP_200_OK)
def submit_support_report(
    payload: SupportReportIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """
    Submit a support report. Sends an email to support@carbonefficiencyintel.com.
    """
    subject = (payload.subject or "").strip()
    description = (payload.description or "").strip()

    if not subject or not description:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Subject and description are required.",
        )

    user_email = getattr(current_user, "email", "unknown")
    user_name = getattr(current_user, "full_name", None) or user_email
    org_id = getattr(current_user, "organization_id", None)
    category = (payload.category or "Other").strip()

    email_subject = f"[CEI Support] {category}: {subject}"

    text_body = (
        f"Support report from CEI user\n"
        f"{'=' * 50}\n\n"
        f"From: {user_name} <{user_email}>\n"
        f"Org ID: {org_id}\n"
        f"Category: {category}\n"
        f"Subject: {subject}\n\n"
        f"Description:\n{description}\n\n"
        f"{'=' * 50}\n"
        f"Reply directly to this email to respond to the user."
    )

    html_body = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
        <tr><td style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:20px 32px;">
          <span style="color:#0f172a;font-size:16px;font-weight:700;">CEI Support Report</span>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:6px 0;border-bottom:1px solid #334155;">
              <span style="color:#64748b;font-size:13px;">From</span><br>
              <span style="color:#f1f5f9;font-size:14px;font-weight:600;">{user_name}</span>
              <span style="color:#94a3b8;font-size:13px;"> &lt;{user_email}&gt;</span>
            </td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #334155;">
              <span style="color:#64748b;font-size:13px;">Org ID</span><br>
              <span style="color:#f1f5f9;font-size:14px;">{org_id}</span>
            </td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #334155;">
              <span style="color:#64748b;font-size:13px;">Category</span><br>
              <span style="color:#22c55e;font-size:14px;font-weight:600;">{category}</span>
            </td></tr>
            <tr><td style="padding:6px 0;border-bottom:1px solid #334155;">
              <span style="color:#64748b;font-size:13px;">Subject</span><br>
              <span style="color:#f1f5f9;font-size:15px;font-weight:700;">{subject}</span>
            </td></tr>
            <tr><td style="padding:16px 0 0;">
              <span style="color:#64748b;font-size:13px;">Description</span><br>
              <div style="margin-top:8px;padding:16px;background:#0f172a;border-radius:8px;
                          color:#cbd5e1;font-size:14px;line-height:1.7;white-space:pre-wrap;">{description}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #334155;">
          <p style="margin:0;font-size:12px;color:#475569;">
            Reply directly to this email to respond to {user_name}.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    try:
        from app.core.email import send_email
        send_email(
            to_email="support@carbonefficiencyintel.com",
            subject=email_subject,
            text_body=text_body,
            html_body=html_body,
        )
        logger.info(
            "Support report submitted by user=%s org_id=%s category=%s",
            user_email, org_id, category,
        )
    except Exception:
        logger.exception("Failed to send support report email from user=%s", user_email)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send support report. Please email support@carbonefficiencyintel.com directly.",
        )

    return {"status": "sent"}