# backend/app/services/commercialista_welcome.py
"""
Welcome email for commercialisti who sign up via the Commercialista / Accountant path.
Triggered from auth.py signup when partner_name is set.
Bilingual: IT (default) / EN based on ui_lang.
Includes:
  - Personalised welcome with studio name
  - 3-step quick start
  - Links to the platform and manual
  - Support contact
"""
from __future__ import annotations
import logging
from typing import Optional

logger = logging.getLogger("cei")

MANUAL_URL_EN = "https://app.carbonefficiencyintel.com/CEI_Consultant_Playbook_EN_v2.docx"
MANUAL_URL_IT = "https://app.carbonefficiencyintel.com/CEI_Manuale_Consulenti_IT_v2.docx"
APP_URL = "https://app.carbonefficiencyintel.com"
SUPPORT_EMAIL = "support@carbonefficiencyintel.com"


def _build_email_it(partner_name: str, user_name: Optional[str]) -> tuple[str, str, str]:
    """Returns (subject, text_body, html_body) in Italian."""
    greeting = f"Caro {user_name}," if user_name else "Benvenuto,"
    subject = f"Benvenuto su CEI — La tua piattaforma CBAM per i clienti di {partner_name}"

    text_body = f"""{greeting}

Il tuo account CEI è stato creato con successo per {partner_name}.

CEI ti permette di generare report CBAM e analisi ETS per i tuoi clienti manifatturieri in pochi minuti — senza installare hardware.

─── COME INIZIARE IN 3 PASSI ───────────────────────────────────────

1. GENERA UN LINK DI INVITO
   Dalla tua dashboard, vai su "Partner Invite Links" e crea un link per il tuo primo cliente.
   Il link è valido 30 giorni e può essere revocato in qualsiasi momento.

2. IL CLIENTE SI REGISTRA
   Invia il link al responsabile dello stabilimento. Si registra in meno di 2 minuti.
   Il loro account viene collegato automaticamente al tuo studio.

3. GENERA I TUOI REPORT CO-BRANDIZZATI
   Carica le bollette del cliente, clicca "CBAM Exposure" o "Compliance Check" e scarica il PDF.
   Il report riporta il nome del tuo studio in intestazione — pronto da consegnare al cliente.

─── ACCEDI ALLA DASHBOARD ──────────────────────────────────────────

{APP_URL}/commercialista

─── SCARICA IL MANUALE ─────────────────────────────────────────────

Manuale completo per consulenti (IT): {MANUAL_URL_IT}
Consultant Playbook (EN): {MANUAL_URL_EN}

─── SUPPORTO ────────────────────────────────────────────────────────

Per assistenza tecnica: {SUPPORT_EMAIL}
Per domande normative (CBAM/ETS): consulta FIRE (federazione.it) o FEDERESCO (federesco.org)

Cordiali saluti,
Il team CEI — Carbon Efficiency Intelligence
carbonefficiencyintel.com
"""

    html_body = f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Benvenuto su CEI</title>
<style>
  body {{ margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }}
  .wrapper {{ max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }}
  .header {{ background: #0f172a; padding: 32px 40px 28px; text-align: center; }}
  .header-brand {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #38bdf8; margin-bottom: 6px; }}
  .header-title {{ font-size: 22px; font-weight: 700; color: #f1f5f9; margin: 0; }}
  .header-sub {{ font-size: 13px; color: #94a3b8; margin-top: 6px; }}
  .accent-bar {{ height: 3px; background: linear-gradient(90deg, #38bdf8, #22c55e); }}
  .body {{ padding: 36px 40px; }}
  .greeting {{ font-size: 15px; color: #334155; margin-bottom: 8px; }}
  .intro {{ font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 28px; }}
  .steps-heading {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; font-weight: 600; margin-bottom: 16px; }}
  .step {{ display: flex; gap: 16px; margin-bottom: 20px; align-items: flex-start; }}
  .step-num {{ width: 32px; height: 32px; border-radius: 50%; background: #0f172a; color: #38bdf8; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }}
  .step-body {{ flex: 1; }}
  .step-title {{ font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 4px; }}
  .step-desc {{ font-size: 13px; color: #64748b; line-height: 1.5; }}
  .cta-block {{ background: #f8fafc; border-radius: 8px; padding: 24px; text-align: center; margin: 28px 0; border: 1px solid #e2e8f0; }}
  .cta-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 12px; }}
  .cta-btn {{ display: inline-block; background: #22c55e; color: #0f172a; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 999px; text-decoration: none; }}
  .manual-block {{ background: #eff6ff; border-radius: 8px; padding: 20px 24px; margin: 20px 0; border: 1px solid #bfdbfe; }}
  .manual-title {{ font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #3b82f6; font-weight: 600; margin-bottom: 10px; }}
  .manual-link {{ display: block; font-size: 13px; color: #1d4ed8; text-decoration: none; margin-bottom: 6px; }}
  .support-block {{ font-size: 13px; color: #64748b; margin-top: 24px; line-height: 1.6; }}
  .footer {{ background: #f8fafc; padding: 20px 40px; text-align: center; border-top: 1px solid #e2e8f0; }}
  .footer-text {{ font-size: 11px; color: #94a3b8; }}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-brand">Carbon Efficiency Intelligence</div>
    <div class="header-title">Benvenuto su CEI</div>
    <div class="header-sub">{partner_name}</div>
  </div>
  <div class="accent-bar"></div>
  <div class="body">
    <div class="greeting">{greeting}</div>
    <div class="intro">
      Il tuo account CEI è pronto. Puoi ora generare report <strong>CBAM</strong> e analisi <strong>ETS Phase 4</strong>
      per i tuoi clienti manifatturieri — senza installare hardware, partendo dalle bollette esistenti.
    </div>

    <div class="steps-heading">Come iniziare in 3 passi</div>

    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-title">Genera un link di invito</div>
        <div class="step-desc">Dalla dashboard, vai su <em>Partner Invite Links</em> e crea un link per il tuo primo cliente. Valido 30 giorni, revocabile in qualsiasi momento.</div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-title">Il cliente si registra</div>
        <div class="step-desc">Invia il link al responsabile dello stabilimento. Si registra in meno di 2 minuti e il suo account viene collegato automaticamente al tuo studio.</div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-title">Genera report co-brandizzati</div>
        <div class="step-desc">Carica le bollette, clicca <em>CBAM Exposure</em> o <em>Compliance Check</em> e scarica il PDF con il nome del tuo studio in intestazione — pronto da consegnare.</div>
      </div>
    </div>

    <div class="cta-block">
      <div class="cta-label">Accedi alla tua dashboard</div>
      <a href="{APP_URL}/commercialista" class="cta-btn">Apri CEI →</a>
    </div>

    <div class="manual-block">
      <div class="manual-title">📋 Manuali e documentazione</div>
      <a href="{MANUAL_URL_IT}" class="manual-link">📄 Manuale per Consulenti (Italiano)</a>
      <a href="{MANUAL_URL_EN}" class="manual-link">📄 Consultant Playbook (English)</a>
    </div>

    <div class="support-block">
      Per assistenza tecnica: <a href="mailto:{SUPPORT_EMAIL}" style="color:#3b82f6;">{SUPPORT_EMAIL}</a><br>
      Per domande normative CBAM/ETS: <a href="https://federazione.it" style="color:#3b82f6;">FIRE</a> · <a href="https://federesco.org" style="color:#3b82f6;">FEDERESCO</a>
    </div>
  </div>
  <div class="footer">
    <div class="footer-text">
      CEI — Carbon Efficiency Intelligence · <a href="https://carbonefficiencyintel.com" style="color:#94a3b8;">carbonefficiencyintel.com</a><br>
      Hai ricevuto questa email perché hai creato un account su CEI.
    </div>
  </div>
</div>
</body>
</html>"""

    return subject, text_body, html_body


def _build_email_en(partner_name: str, user_name: Optional[str]) -> tuple[str, str, str]:
    """Returns (subject, text_body, html_body) in English."""
    greeting = f"Dear {user_name}," if user_name else "Welcome,"
    subject = f"Welcome to CEI — Your CBAM compliance platform for {partner_name} clients"

    text_body = f"""{greeting}

Your CEI account has been created successfully for {partner_name}.

CEI lets you generate CBAM exposure reports and ETS compliance assessments for your manufacturing clients in minutes — no hardware required.

─── GET STARTED IN 3 STEPS ─────────────────────────────────────────

1. GENERATE AN INVITE LINK
   From your dashboard, go to "Partner Invite Links" and create a link for your first client.
   Links are valid for 30 days and can be revoked at any time.

2. CLIENT SIGNS UP
   Send the link to the factory manager. They sign up in under 2 minutes.
   Their account connects to your practice automatically.

3. GENERATE CO-BRANDED REPORTS
   Upload the client's utility bills, click "CBAM Exposure" or "Compliance Check" and download the PDF.
   The report shows your practice name in the header — ready to hand to the client.

─── ACCESS YOUR DASHBOARD ──────────────────────────────────────────

{APP_URL}/commercialista

─── DOWNLOAD THE MANUAL ────────────────────────────────────────────

Consultant Playbook (EN): {MANUAL_URL_EN}
Manuale Consulenti (IT): {MANUAL_URL_IT}

─── SUPPORT ─────────────────────────────────────────────────────────

For technical support: {SUPPORT_EMAIL}
For CBAM/ETS regulatory questions: FIRE (federazione.it) or FEDERESCO (federesco.org)

Best regards,
The CEI Team — Carbon Efficiency Intelligence
carbonefficiencyintel.com
"""

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to CEI</title>
<style>
  body {{ margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }}
  .wrapper {{ max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }}
  .header {{ background: #0f172a; padding: 32px 40px 28px; text-align: center; }}
  .header-brand {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #38bdf8; margin-bottom: 6px; }}
  .header-title {{ font-size: 22px; font-weight: 700; color: #f1f5f9; margin: 0; }}
  .header-sub {{ font-size: 13px; color: #94a3b8; margin-top: 6px; }}
  .accent-bar {{ height: 3px; background: linear-gradient(90deg, #38bdf8, #22c55e); }}
  .body {{ padding: 36px 40px; }}
  .greeting {{ font-size: 15px; color: #334155; margin-bottom: 8px; }}
  .intro {{ font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 28px; }}
  .steps-heading {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; font-weight: 600; margin-bottom: 16px; }}
  .step {{ display: flex; gap: 16px; margin-bottom: 20px; align-items: flex-start; }}
  .step-num {{ width: 32px; height: 32px; border-radius: 50%; background: #0f172a; color: #38bdf8; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }}
  .step-body {{ flex: 1; }}
  .step-title {{ font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 4px; }}
  .step-desc {{ font-size: 13px; color: #64748b; line-height: 1.5; }}
  .cta-block {{ background: #f8fafc; border-radius: 8px; padding: 24px; text-align: center; margin: 28px 0; border: 1px solid #e2e8f0; }}
  .cta-label {{ font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 12px; }}
  .cta-btn {{ display: inline-block; background: #22c55e; color: #0f172a; font-size: 14px; font-weight: 700; padding: 12px 28px; border-radius: 999px; text-decoration: none; }}
  .manual-block {{ background: #eff6ff; border-radius: 8px; padding: 20px 24px; margin: 20px 0; border: 1px solid #bfdbfe; }}
  .manual-title {{ font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #3b82f6; font-weight: 600; margin-bottom: 10px; }}
  .manual-link {{ display: block; font-size: 13px; color: #1d4ed8; text-decoration: none; margin-bottom: 6px; }}
  .support-block {{ font-size: 13px; color: #64748b; margin-top: 24px; line-height: 1.6; }}
  .footer {{ background: #f8fafc; padding: 20px 40px; text-align: center; border-top: 1px solid #e2e8f0; }}
  .footer-text {{ font-size: 11px; color: #94a3b8; }}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-brand">Carbon Efficiency Intelligence</div>
    <div class="header-title">Welcome to CEI</div>
    <div class="header-sub">{partner_name}</div>
  </div>
  <div class="accent-bar"></div>
  <div class="body">
    <div class="greeting">{greeting}</div>
    <div class="intro">
      Your CEI account is ready. You can now generate <strong>CBAM exposure reports</strong> and
      <strong>ETS Phase 4 compliance assessments</strong> for your manufacturing clients —
      no hardware required, starting from existing utility bills.
    </div>

    <div class="steps-heading">Get started in 3 steps</div>

    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-title">Generate an invite link</div>
        <div class="step-desc">From your dashboard, go to <em>Partner Invite Links</em> and create a link for your first client. Valid for 30 days, revocable at any time.</div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-title">Client signs up</div>
        <div class="step-desc">Send the link to the factory manager. They sign up in under 2 minutes and their account connects to your practice automatically.</div>
      </div>
    </div>

    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <div class="step-title">Generate co-branded reports</div>
        <div class="step-desc">Upload the client's utility bills, click <em>CBAM Exposure</em> or <em>Compliance Check</em> and download the PDF with your practice name in the header.</div>
      </div>
    </div>

    <div class="cta-block">
      <div class="cta-label">Access your dashboard</div>
      <a href="{APP_URL}/commercialista" class="cta-btn">Open CEI →</a>
    </div>

    <div class="manual-block">
      <div class="manual-title">📋 Manuals & documentation</div>
      <a href="{MANUAL_URL_EN}" class="manual-link">📄 Consultant Playbook (English)</a>
      <a href="{MANUAL_URL_IT}" class="manual-link">📄 Manuale Consulenti (Italiano)</a>
    </div>

    <div class="support-block">
      Technical support: <a href="mailto:{SUPPORT_EMAIL}" style="color:#3b82f6;">{SUPPORT_EMAIL}</a><br>
      CBAM/ETS regulatory questions: <a href="https://federazione.it" style="color:#3b82f6;">FIRE</a> · <a href="https://federesco.org" style="color:#3b82f6;">FEDERESCO</a>
    </div>
  </div>
  <div class="footer">
    <div class="footer-text">
      CEI — Carbon Efficiency Intelligence · <a href="https://carbonefficiencyintel.com" style="color:#94a3b8;">carbonefficiencyintel.com</a><br>
      You received this email because you created an account on CEI.
    </div>
  </div>
</div>
</body>
</html>"""

    return subject, text_body, html_body


def send_commercialista_welcome(
    *,
    to_email: str,
    partner_name: str,
    user_name: Optional[str] = None,
    lang: str = "it",
) -> None:
    """
    Send the commercialista welcome email.
    Called from auth.py signup when partner_name is set.
    Non-blocking — errors are logged but do not fail the signup.
    """
    try:
        from app.core.email import send_email
        if lang and lang.strip().lower().startswith("en"):
            subject, text_body, html_body = _build_email_en(partner_name, user_name)
        else:
            subject, text_body, html_body = _build_email_it(partner_name, user_name)

        send_email(
            to_email=to_email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
        logger.info("Commercialista welcome email sent to %s (lang=%s)", to_email, lang)
    except Exception as exc:
        logger.warning("Failed to send commercialista welcome email to %s: %s", to_email, exc)
