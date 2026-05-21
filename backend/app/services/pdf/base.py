"""
CEI PDF Foundation
==================
Shared letterhead, styles, document template, and reusable flowable helpers.
Every CEI compliance document inherits from CEIDocTemplate and uses these helpers.

Assets expected at:
    backend/app/services/pdf/assets/cei_logo.png
    backend/app/services/pdf/assets/fonts/Inter-Regular.ttf
    backend/app/services/pdf/assets/fonts/Inter-SemiBold.ttf
    backend/app/services/pdf/assets/fonts/Inter-Bold.ttf
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import List, Optional

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# ---------------------------------------------------------------------------
# Font registration — Inter (matches CEI web app typography)
# Falls back to Helvetica if TTF files are not found.
# ---------------------------------------------------------------------------
ASSETS_DIR = Path(__file__).parent / "assets"
FONTS_DIR  = ASSETS_DIR / "fonts"
LOGO_PATH  = ASSETS_DIR / "cei_logo.png"

_FONT_REGULAR  = "Inter"
_FONT_BOLD     = "Inter-Bold"
_FONT_SEMIBOLD = "Inter-SemiBold"

def _register_fonts() -> bool:
    try:
        pdfmetrics.registerFont(TTFont("Inter",          str(FONTS_DIR / "Inter-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("Inter-Bold",     str(FONTS_DIR / "Inter-Bold.ttf")))
        pdfmetrics.registerFont(TTFont("Inter-SemiBold", str(FONTS_DIR / "Inter-SemiBold.ttf")))
        return True
    except Exception:
        # Graceful fallback — documents still render with Helvetica
        global _FONT_REGULAR, _FONT_BOLD, _FONT_SEMIBOLD
        _FONT_REGULAR  = "Helvetica"
        _FONT_BOLD     = "Helvetica-Bold"
        _FONT_SEMIBOLD = "Helvetica-Bold"
        return False

_FONTS_LOADED = _register_fonts()


# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------
C_SURFACE    = HexColor("#0f172a")
C_SURFACE_2  = HexColor("#1e293b")
C_ACCENT     = HexColor("#38bdf8")
C_GREEN      = HexColor("#22c55e")
C_GREEN_D    = HexColor("#16a34a")
C_AMBER      = HexColor("#f59e0b")
C_RED        = HexColor("#ef4444")
C_TEXT_LT    = HexColor("#e5e7eb")
C_MUTED_LT   = HexColor("#94a3b8")
C_TEXT_DK    = HexColor("#111827")
C_MUTED_DK   = HexColor("#4b5563")
C_BORDER     = HexColor("#e2e8f0")
C_ROW_ALT    = HexColor("#f8fafc")
C_HIGHLIGHT  = HexColor("#eff6ff")
C_BOX_BG     = HexColor("#f0f9ff")
C_HEADER_BG  = HexColor("#f8fafc")   # light header — suits logo with white bg

# ---------------------------------------------------------------------------
# Page geometry
# ---------------------------------------------------------------------------
PAGE_W, PAGE_H = A4
MARGIN    = 18 * mm
HEADER_H  = 30 * mm
FOOTER_H  = 17 * mm
BODY_TOP  = PAGE_H - HEADER_H - 5 * mm
BODY_BOT  = FOOTER_H + 4 * mm
BODY_H    = BODY_TOP - BODY_BOT
CONTENT_W = PAGE_W - 2 * MARGIN


# ---------------------------------------------------------------------------
# Paragraph style registry
# ---------------------------------------------------------------------------
def get_styles() -> dict:
    R = _FONT_REGULAR
    B = _FONT_BOLD
    S = _FONT_SEMIBOLD
    return {
        "doc_title": ParagraphStyle(
            "CEIDocTitle", fontName=B, fontSize=15,
            textColor=C_TEXT_DK, spaceAfter=2, leading=18,
        ),
        "doc_subtitle": ParagraphStyle(
            "CEIDocSubtitle", fontName=R, fontSize=9,
            textColor=C_MUTED_DK, spaceAfter=10,
        ),
        "section": ParagraphStyle(
            "CEISection", fontName=S, fontSize=8.5,
            textColor=C_MUTED_DK, spaceBefore=12, spaceAfter=2, letterSpacing=0.6,
        ),
        "body": ParagraphStyle(
            "CEIBody", fontName=R, fontSize=9,
            textColor=C_TEXT_DK, leading=14, spaceAfter=3,
        ),
        "body_bold": ParagraphStyle(
            "CEIBodyBold", fontName=B, fontSize=9,
            textColor=C_TEXT_DK, leading=14,
        ),
        "small": ParagraphStyle(
            "CEISmall", fontName=R, fontSize=7.5,
            textColor=C_MUTED_DK, leading=11, spaceAfter=2,
        ),
        "label": ParagraphStyle(
            "CEILabel", fontName=S, fontSize=8,
            textColor=C_MUTED_DK,
        ),
        "value": ParagraphStyle(
            "CEIValue", fontName=R, fontSize=9,
            textColor=C_TEXT_DK,
        ),
        "kpi_number": ParagraphStyle(
            "CEIKpiNumber", fontName=B, fontSize=18,
            textColor=C_ACCENT, leading=22,
        ),
        "kpi_label": ParagraphStyle(
            "CEIKpiLabel", fontName=R, fontSize=8,
            textColor=C_MUTED_LT,
        ),
        "compliance": ParagraphStyle(
            "CEICompliance", fontName=R, fontSize=8,
            textColor=C_MUTED_DK, leading=12, spaceAfter=4,
        ),
        "center": ParagraphStyle(
            "CEICenter", fontName=R, fontSize=9,
            textColor=C_TEXT_DK, alignment=TA_CENTER,
        ),
        "right": ParagraphStyle(
            "CEIRight", fontName=R, fontSize=9,
            textColor=C_TEXT_DK, alignment=TA_RIGHT,
        ),
    }


# ---------------------------------------------------------------------------
# Canvas-level page decorations
# ---------------------------------------------------------------------------

def _draw_header(canvas, doc, title: str, subtitle: str | None) -> None:
    w, h = A4
    R = _FONT_REGULAR
    B = _FONT_BOLD

    # Light header band
    canvas.setFillColor(C_HEADER_BG)
    canvas.rect(0, h - HEADER_H, w, HEADER_H, fill=1, stroke=0)

    # ── Logo (left) ───────────────────────────────────────────────────────
    logo_h = 20 * mm
    logo_w = 20 * mm   # logo is roughly square; aspect adjusted by drawImage
    logo_y = h - HEADER_H / 2 - logo_h / 2

    if LOGO_PATH.exists():
        canvas.drawImage(
            ImageReader(str(LOGO_PATH)),
            MARGIN,
            logo_y,
            width=logo_w,
            height=logo_h,
            preserveAspectRatio=True,
            mask="auto",
        )
        text_x = MARGIN + logo_w + 4 * mm
    else:
        # Text fallback if logo file missing
        canvas.setFillColor(C_ACCENT)
        canvas.setFont(B, 16)
        canvas.drawString(MARGIN, h - HEADER_H / 2 - 4, "CEI")
        text_x = MARGIN + 34

    # Brand name next to logo
    canvas.setFillColor(C_TEXT_DK)
    canvas.setFont(B, 10)
    canvas.drawString(text_x, h - HEADER_H / 2 + 2, "Carbon Efficiency Intelligence")
    canvas.setFillColor(C_MUTED_DK)
    canvas.setFont(R, 7.5)
    canvas.drawString(text_x, h - HEADER_H / 2 - 9, "carbonefficiencyintel.com")

    # Thin vertical separator
    canvas.setStrokeColor(C_BORDER)
    canvas.setLineWidth(0.7)
    mid_x = MARGIN + logo_w + 4 * mm + 90 * mm
    canvas.line(mid_x, h - HEADER_H + 6 * mm, mid_x, h - 6 * mm)

    # ── Document title (right) ────────────────────────────────────────────
    canvas.setFillColor(C_TEXT_DK)
    canvas.setFont(B, 10)
    canvas.drawRightString(w - MARGIN, h - HEADER_H / 2 + 3, title)
    if subtitle:
        canvas.setFillColor(C_MUTED_DK)
        canvas.setFont(R, 8)
        canvas.drawRightString(w - MARGIN, h - HEADER_H / 2 - 10, subtitle)

    # Accent bottom border
    canvas.setStrokeColor(C_ACCENT)
    canvas.setLineWidth(2.5)
    canvas.line(0, h - HEADER_H, w, h - HEADER_H)


def _draw_footer(canvas, doc, lang: str = "en") -> None:
    w, h = A4
    R = _FONT_REGULAR
    B = _FONT_BOLD

    # Separator
    canvas.setStrokeColor(C_BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, FOOTER_H + 2 * mm, w - MARGIN, FOOTER_H + 2 * mm)

    # Left: disclaimer
    canvas.setFont(R, 6.5)
    canvas.setFillColor(C_MUTED_DK)
    from app.services.pdf.i18n import t
    canvas.setFont(R, 6.0)
    canvas.drawString(
        MARGIN, FOOTER_H - 0.5 * mm,
        t("footer_disclaimer", lang),
    )

    # Right: page number
    canvas.setFont(B, 8)
    canvas.setFillColor(C_TEXT_DK)
    canvas.drawRightString(w - MARGIN, FOOTER_H + 1 * mm, f"Page {doc.page}")

    # Generation timestamp
    canvas.setFont(R, 6.5)
    canvas.setFillColor(C_MUTED_DK)
    canvas.drawString(
        MARGIN, FOOTER_H - 6 * mm,
        f"{t('generated_by', lang)}  ·  {datetime.utcnow().strftime('%d %b %Y, %H:%M UTC')}",
    )


# ---------------------------------------------------------------------------
# Document Template
# ---------------------------------------------------------------------------

class CEIDocTemplate(BaseDocTemplate):
    def __init__(
        self,
        buffer: BytesIO,
        doc_title: str,
        doc_subtitle: str | None = None,
        lang: str = "en",
        **kwargs,
    ):
        self._doc_title    = doc_title
        self._doc_subtitle = doc_subtitle
        self._lang         = lang
        super().__init__(
            buffer, pagesize=A4,
            leftMargin=MARGIN, rightMargin=MARGIN,
            topMargin=HEADER_H + 5 * mm,
            bottomMargin=FOOTER_H + 5 * mm,
            **kwargs,
        )
        frame = Frame(
            MARGIN, BODY_BOT, CONTENT_W, BODY_H,
            id="main",
            leftPadding=0, rightPadding=0,
            topPadding=4, bottomPadding=4,
        )
        self.addPageTemplates(
            [PageTemplate(id="cei", frames=[frame], onPage=self._on_page)]
        )

    def _on_page(self, canvas, doc) -> None:
        canvas.saveState()
        _draw_header(canvas, doc, self._doc_title, self._doc_subtitle)
        _draw_footer(canvas, doc, self._lang)
        canvas.restoreState()


# ---------------------------------------------------------------------------
# Reusable flowable helpers
# ---------------------------------------------------------------------------

def spacer(h_mm: float = 4) -> Spacer:
    return Spacer(1, h_mm * mm)


def section_title(text: str) -> List:
    s = get_styles()
    return [
        Spacer(1, 3 * mm),
        Paragraph(text.upper(), s["section"]),
        HRFlowable(width="100%", thickness=0.5, color=C_BORDER, spaceAfter=5),
    ]


def kv_table(
    rows: List[tuple],
    col_widths: tuple = (68 * mm, 102 * mm),
) -> Table:
    s = get_styles()
    data = [
        [Paragraph(str(k), s["label"]), Paragraph(str(v), s["value"])]
        for k, v in rows
    ]
    t = Table(data, colWidths=list(col_widths))
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), white),
        ("ROWBACKGROUNDS",(0, 0), (-1, -1), [white, C_ROW_ALT]),
        ("BOX",           (0, 0), (-1, -1), 0.4, C_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, C_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def data_table(
    headers: List[str],
    rows: List[List],
    col_widths: List[float] | None = None,
    highlight_last: bool = False,
    right_align_from: int = 1,
) -> Table:
    s = get_styles()
    n = len(headers)
    col_w = col_widths or [CONTENT_W / n] * n

    header_row = [Paragraph(f"<b>{h}</b>", s["small"]) for h in headers]
    body_rows  = [[Paragraph(str(cell), s["body"]) for cell in row] for row in rows]
    all_rows   = [header_row] + body_rows

    t = Table(all_rows, colWidths=col_w)
    style_cmds = [
        ("BACKGROUND",    (0, 0),  (-1, 0),   C_SURFACE),
        ("TEXTCOLOR",     (0, 0),  (-1, 0),   C_TEXT_LT),
        ("FONTNAME",      (0, 0),  (-1, 0),   _FONT_SEMIBOLD),
        ("FONTSIZE",      (0, 0),  (-1, 0),   8),
        ("ROWBACKGROUNDS",(0, 1),  (-1, -1),  [white, C_ROW_ALT]),
        ("BOX",           (0, 0),  (-1, -1),  0.4, C_BORDER),
        ("INNERGRID",     (0, 0),  (-1, -1),  0.3, C_BORDER),
        ("TOPPADDING",    (0, 0),  (-1, -1),  4),
        ("BOTTOMPADDING", (0, 0),  (-1, -1),  4),
        ("LEFTPADDING",   (0, 0),  (-1, -1),  6),
        ("RIGHTPADDING",  (0, 0),  (-1, -1),  6),
        ("VALIGN",        (0, 0),  (-1, -1),  "MIDDLE"),
        ("ALIGN",         (right_align_from, 1), (-1, -1), "RIGHT"),
        ("ALIGN",         (right_align_from, 0), (-1, 0),  "RIGHT"),
    ]
    if highlight_last and body_rows:
        last = len(all_rows) - 1
        style_cmds += [
            ("BACKGROUND", (0, last), (-1, last), C_HIGHLIGHT),
            ("FONTNAME",   (0, last), (-1, last), _FONT_BOLD),
            ("TEXTCOLOR",  (0, last), (-1, last), C_TEXT_DK),
        ]
    t.setStyle(TableStyle(style_cmds))
    return t


def compliance_box(text: str) -> Table:
    s = get_styles()
    t = Table([[Paragraph(text, s["compliance"])]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BOX",           (0, 0), (-1, -1), 0.9, C_ACCENT),
        ("BACKGROUND",    (0, 0), (-1, -1), C_BOX_BG),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def result_box(label: str, value: str, unit: str = "", sub: str = "") -> Table:
    s = get_styles()
    inner_rows = [
        [Paragraph(label, s["kpi_label"])],
        [Paragraph(value, s["kpi_number"])],
        [Paragraph(unit,  s["kpi_label"])],
    ]
    if sub:
        inner_rows.append([Paragraph(sub, s["kpi_label"])])
    inner = Table(inner_rows, colWidths=[CONTENT_W - 24])
    inner.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
    ]))
    outer = Table([[inner]], colWidths=[CONTENT_W])
    outer.setStyle(TableStyle([
        ("BOX",           (0, 0), (-1, -1), 1.5, C_ACCENT),
        ("BACKGROUND",    (0, 0), (-1, -1), C_SURFACE),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return outer


def info_box(text: str, color: HexColor = C_AMBER) -> Table:
    s = get_styles()
    t = Table([[Paragraph(text, s["small"])]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("LINEBEFORE",    (0, 0), (0, -1), 3, color),
        ("BACKGROUND",    (0, 0), (-1, -1), C_ROW_ALT),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def signature_block(
    name: str,
    organisation: str,
    date_str: str,
    role: str = "Certified Energy Manager",
) -> Table:
    s = get_styles()
    col_w = [CONTENT_W * 0.38, CONTENT_W * 0.38, CONTENT_W * 0.24]
    header = [
        Paragraph("SIGNATORY / VERIFIER", s["label"]),
        Paragraph("ORGANISATION",         s["label"]),
        Paragraph("DATE",                 s["label"]),
    ]
    values = [
        Paragraph(name,         s["body"]),
        Paragraph(organisation, s["body"]),
        Paragraph(date_str,     s["body"]),
    ]
    sub = [
        Paragraph(role, s["small"]),
        Paragraph("",   s["small"]),
        Paragraph("",   s["small"]),
    ]
    lines = [
        Paragraph("_" * 32, s["small"]),
        Paragraph("_" * 32, s["small"]),
        Paragraph("_" * 18, s["small"]),
    ]
    t = Table([header, values, sub, lines], colWidths=col_w)
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  C_SURFACE),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  C_TEXT_LT),
        ("FONTNAME",      (0, 0), (-1, 0),  _FONT_SEMIBOLD),
        ("FONTSIZE",      (0, 0), (-1, 0),  7.5),
        ("BOX",           (0, 0), (-1, -1), 0.5, C_BORDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, C_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t