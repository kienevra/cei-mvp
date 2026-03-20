# backend/app/services/reporting.py
from __future__ import annotations

import json
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------

CEI_GREEN = colors.HexColor("#1A7A4A")
CEI_GREEN_LIGHT = colors.HexColor("#E8F5EE")
CEI_DARK = colors.HexColor("#1A1A2E")
CEI_GREY = colors.HexColor("#6B7280")
CEI_GREY_LIGHT = colors.HexColor("#F3F4F6")
CEI_RED = colors.HexColor("#DC2626")
CEI_AMBER = colors.HexColor("#D97706")
CEI_BLUE = colors.HexColor("#2563EB")
WHITE = colors.white


# ---------------------------------------------------------------------------
# Style helpers
# ---------------------------------------------------------------------------

def _styles():
    base = getSampleStyleSheet()

    custom = {
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontSize=26,
            textColor=CEI_DARK,
            spaceAfter=4 * mm,
            leading=30,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["Normal"],
            fontSize=12,
            textColor=CEI_GREY,
            spaceAfter=2 * mm,
        ),
        "section_heading": ParagraphStyle(
            "section_heading",
            parent=base["Heading2"],
            fontSize=13,
            textColor=CEI_GREEN,
            spaceBefore=6 * mm,
            spaceAfter=2 * mm,
            fontName="Helvetica-Bold",
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontSize=10,
            textColor=CEI_DARK,
            spaceAfter=1 * mm,
            leading=14,
        ),
        "body_grey": ParagraphStyle(
            "body_grey",
            parent=base["Normal"],
            fontSize=9,
            textColor=CEI_GREY,
            spaceAfter=1 * mm,
        ),
        "kpi_label": ParagraphStyle(
            "kpi_label",
            parent=base["Normal"],
            fontSize=9,
            textColor=CEI_GREY,
            alignment=TA_CENTER,
        ),
        "kpi_value": ParagraphStyle(
            "kpi_value",
            parent=base["Normal"],
            fontSize=18,
            textColor=CEI_DARK,
            fontName="Helvetica-Bold",
            alignment=TA_CENTER,
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base["Normal"],
            fontSize=9,
            textColor=WHITE,
            fontName="Helvetica-Bold",
            alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "table_cell",
            parent=base["Normal"],
            fontSize=9,
            textColor=CEI_DARK,
            alignment=TA_LEFT,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontSize=8,
            textColor=CEI_GREY,
            alignment=TA_CENTER,
        ),
    }
    return custom


def _fmt_dt(dt: Optional[datetime], fmt: str = "%Y-%m-%d %H:%M UTC") -> str:
    if not dt:
        return "—"
    if hasattr(dt, "strftime"):
        return dt.strftime(fmt)
    return str(dt)


def _fmt_num(val: Optional[float], decimals: int = 2, suffix: str = "") -> str:
    if val is None:
        return "—"
    return f"{val:,.{decimals}f}{suffix}"


# ---------------------------------------------------------------------------
# Page numbering canvas
# ---------------------------------------------------------------------------

class _NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_page_number(self, page_count: int):
        self.setFont("Helvetica", 8)
        self.setFillColor(CEI_GREY)
        self.drawRightString(
            A4[0] - 15 * mm,
            10 * mm,
            f"Page {self._pageNumber} of {page_count}",
        )
        self.drawString(
            15 * mm,
            10 * mm,
            "CEI Platform — Confidential",
        )


# ---------------------------------------------------------------------------
# KPI card helper
# ---------------------------------------------------------------------------

def _kpi_table(items: List[tuple], styles: Dict) -> Table:
    """
    Render a row of KPI cards.
    items: list of (label, value) tuples
    """
    col_w = (A4[0] - 30 * mm) / len(items)

    header_row = [Paragraph(label, styles["kpi_label"]) for label, _ in items]
    value_row = [Paragraph(str(value), styles["kpi_value"]) for _, value in items]

    t = Table([header_row, value_row], colWidths=[col_w] * len(items))
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CEI_GREEN_LIGHT),
        ("ROUNDEDCORNERS", [4]),
        ("BOX", (0, 0), (-1, -1), 0.5, CEI_GREEN),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#C6E6D4")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


# ---------------------------------------------------------------------------
# Data table helper
# ---------------------------------------------------------------------------

def _data_table(
    headers: List[str],
    rows: List[List[Any]],
    col_widths: Optional[List[float]] = None,
    styles_dict: Optional[Dict] = None,
) -> Table:
    s = styles_dict or _styles()

    header_cells = [Paragraph(h, s["table_header"]) for h in headers]
    data_rows = []
    for row in rows:
        data_rows.append([
            Paragraph(str(cell) if cell is not None else "—", s["table_cell"])
            for cell in row
        ])

    table_data = [header_cells] + data_rows

    usable_width = A4[0] - 30 * mm
    if not col_widths:
        col_widths = [usable_width / len(headers)] * len(headers)

    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), CEI_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        # Data rows
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, CEI_GREY_LIGHT]),
        # Grid
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


# ---------------------------------------------------------------------------
# Main PDF generator
# ---------------------------------------------------------------------------

def generate_client_org_pdf(report: Any) -> bytes:
    """
    Generate a multi-section PDF report for a client org.

    Accepts either a ClientReportOut Pydantic object or a plain dict
    (for flexibility).

    Sections:
      1. Cover — managing org, client org, generation timestamp
      2. Summary KPIs — total sites, records, last ingestion, open alerts
      3. Energy configuration — pricing, sources, currency
      4. Sites — table of all sites with site_id and location
      5. Ingestion detail — records by window, active vs silent sites
      6. Alert summary — open, critical, last 7 days
      7. Integration tokens — active vs total
      8. Audit trail — last 20 events
    """
    # Normalise: accept Pydantic model or dict
    if hasattr(report, "model_dump"):
        r = report.model_dump()
    elif hasattr(report, "dict"):
        r = report.dict()
    else:
        r = dict(report)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=f"CEI Report — {r.get('client_org_name', 'Client')}",
        author="CEI Platform",
    )

    s = _styles()
    story = []

    # -------------------------------------------------------------------
    # 1. Cover
    # -------------------------------------------------------------------
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("Carbon Efficiency Intelligence", s["cover_sub"]))
    story.append(Paragraph(
        f"Client Report: {r.get('client_org_name', '—')}",
        s["cover_title"],
    ))
    story.append(HRFlowable(width="100%", thickness=1.5, color=CEI_GREEN, spaceAfter=4 * mm))

    meta_rows = [
        ["Managing Organization", r.get("managing_org_name", "—")],
        ["Client Organization", r.get("client_org_name", "—")],
        ["Client Since", _fmt_dt(r.get("client_org_created_at"), "%Y-%m-%d")],
        ["Report Generated", _fmt_dt(r.get("generated_at"))],
    ]
    meta_table = Table(meta_rows, colWidths=[60 * mm, 110 * mm])
    meta_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), CEI_GREY),
        ("TEXTCOLOR", (1, 0), (1, -1), CEI_DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 8 * mm))

    # -------------------------------------------------------------------
    # 2. Summary KPIs
    # -------------------------------------------------------------------
    story.append(Paragraph("Summary", s["section_heading"]))
    story.append(_kpi_table([
        ("Total Sites", r.get("total_sites", 0)),
        ("Total Records", f"{r.get('total_timeseries_records', 0):,}"),
        ("Records (24h)", f"{r.get('records_last_24h', 0):,}"),
        ("Records (7d)", f"{r.get('records_last_7d', 0):,}"),
        ("Open Alerts", r.get("open_alerts", 0)),
        ("Critical Alerts", r.get("critical_alerts", 0)),
    ], s))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        f"Last ingestion: {_fmt_dt(r.get('last_ingestion_at'))}",
        s["body_grey"],
    ))

    # -------------------------------------------------------------------
    # 3. Energy configuration
    # -------------------------------------------------------------------
    story.append(Paragraph("Energy Configuration", s["section_heading"]))
    energy_rows = [
        ["Energy Sources", r.get("primary_energy_sources") or "—"],
        ["Electricity Price", _fmt_num(r.get("electricity_price_per_kwh"), 4, " /kWh")],
        ["Gas Price", _fmt_num(r.get("gas_price_per_kwh"), 4, " /kWh")],
        ["Currency", r.get("currency_code") or "—"],
    ]
    energy_table = Table(energy_rows, colWidths=[60 * mm, 110 * mm])
    energy_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), CEI_GREY),
        ("TEXTCOLOR", (1, 0), (1, -1), CEI_DARK),
        ("BACKGROUND", (0, 0), (-1, -1), CEI_GREY_LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(energy_table)

    # -------------------------------------------------------------------
    # 4. Sites
    # -------------------------------------------------------------------
    story.append(Paragraph("Sites", s["section_heading"]))
    sites = r.get("sites") or []
    active_site_ids = set(r.get("active_site_ids") or [])

    if sites:
        site_rows = []
        for site in sites:
            sid = site.get("site_id") or f"site-{site.get('id')}"
            status = "Active" if sid in active_site_ids else "No data"
            status_color = CEI_GREEN if status == "Active" else CEI_AMBER
            site_rows.append([
                site.get("name", "—"),
                sid,
                site.get("location") or "—",
                _fmt_dt(site.get("created_at"), "%Y-%m-%d"),
                status,
            ])

        usable = A4[0] - 30 * mm
        sites_table = _data_table(
            ["Site Name", "Site ID", "Location", "Created", "Status"],
            site_rows,
            col_widths=[usable * 0.28, usable * 0.18, usable * 0.22, usable * 0.16, usable * 0.16],
            styles_dict=s,
        )

        # Colour the status column
        for i, site in enumerate(sites):
            sid = site.get("site_id") or f"site-{site.get('id')}"
            color = CEI_GREEN if sid in active_site_ids else CEI_AMBER
            sites_table.setStyle(TableStyle([
                ("TEXTCOLOR", (4, i + 1), (4, i + 1), color),
                ("FONTNAME", (4, i + 1), (4, i + 1), "Helvetica-Bold"),
            ]))

        story.append(sites_table)
    else:
        story.append(Paragraph("No sites configured for this organization.", s["body_grey"]))

    # -------------------------------------------------------------------
    # 5. Ingestion detail
    # -------------------------------------------------------------------
    story.append(Paragraph("Ingestion Detail", s["section_heading"]))
    ingestion_rows = [
        ["Total records", f"{r.get('total_timeseries_records', 0):,}"],
        ["Records in last 24h", f"{r.get('records_last_24h', 0):,}"],
        ["Records in last 7d", f"{r.get('records_last_7d', 0):,}"],
        ["Last ingestion", _fmt_dt(r.get("last_ingestion_at"))],
        ["Active sites (have data)", str(len(active_site_ids))],
        ["Silent sites (no data)", str(max(0, len(sites) - len(active_site_ids)))],
    ]
    ing_table = Table(ingestion_rows, colWidths=[80 * mm, 90 * mm])
    ing_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), CEI_GREY),
        ("TEXTCOLOR", (1, 0), (1, -1), CEI_DARK),
        ("BACKGROUND", (0, 0), (-1, -1), CEI_GREY_LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(ing_table)

    # -------------------------------------------------------------------
    # 6. Alert summary
    # -------------------------------------------------------------------
    story.append(Paragraph("Alert Summary", s["section_heading"]))
    alert_kpis = [
        ("Open Alerts", r.get("open_alerts", 0)),
        ("Critical Alerts", r.get("critical_alerts", 0)),
        ("Alerts (7d)", r.get("alerts_last_7d", 0)),
    ]
    story.append(_kpi_table(alert_kpis, s))

    # -------------------------------------------------------------------
    # 7. Integration tokens
    # -------------------------------------------------------------------
    story.append(Paragraph("Integration Tokens", s["section_heading"]))
    token_rows = [
        ["Active tokens", str(r.get("active_tokens", 0))],
        ["Total tokens (incl. revoked)", str(r.get("total_tokens", 0))],
        ["Users", str(r.get("total_users", 0))],
    ]
    tok_table = Table(token_rows, colWidths=[80 * mm, 90 * mm])
    tok_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), CEI_GREY),
        ("TEXTCOLOR", (1, 0), (1, -1), CEI_DARK),
        ("BACKGROUND", (0, 0), (-1, -1), CEI_GREY_LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tok_table)

    # -------------------------------------------------------------------
    # 8. Audit trail
    # -------------------------------------------------------------------
    audit_events = r.get("recent_audit_events") or []
    if audit_events:
        story.append(Paragraph("Recent Activity (last 20 events)", s["section_heading"]))
        audit_rows = [
            [
                _fmt_dt(e.get("created_at"), "%Y-%m-%d %H:%M"),
                e.get("type") or "—",
                e.get("title") or "—",
            ]
            for e in audit_events
        ]
        usable = A4[0] - 30 * mm
        story.append(_data_table(
            ["Timestamp", "Type", "Event"],
            audit_rows,
            col_widths=[usable * 0.22, usable * 0.18, usable * 0.60],
            styles_dict=s,
        ))

    # -------------------------------------------------------------------
    # Build
    # -------------------------------------------------------------------
    doc.build(story, canvasmaker=_NumberedCanvas)
    buffer.seek(0)
    return buffer.read()


# ---------------------------------------------------------------------------
# Legacy ReportingService (kept for back-compat with existing /reports endpoint)
# ---------------------------------------------------------------------------

class ReportingService:
    def __init__(self):
        pass

    def generate_pdf_report(self, site_name, kpis, opportunities):
        """
        Legacy single-site PDF — kept for back-compat.
        For client org reports use generate_client_org_pdf() directly.
        """
        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        c.setFont("Helvetica-Bold", 16)
        c.drawString(50, height - 50, f"Site Report: {site_name}")
        c.setFont("Helvetica", 12)
        y = height - 90
        c.drawString(50, y, "KPIs:")
        for k, v in kpis.items():
            y -= 20
            c.drawString(70, y, f"{k}: {v}")
        y -= 30
        c.drawString(50, y, "Opportunities (Ranked):")
        for i, opp in enumerate(opportunities, 1):
            y -= 20
            c.drawString(
                70, y,
                f"{i}. {opp['name']} - ROI: {opp['simple_roi_years']:.2f} yrs, "
                f"CO2 Saved: {opp['est_co2_tons_saved_per_year']:.2f} t",
            )
        c.showPage()
        c.save()
        buffer.seek(0)
        return buffer.read()

    def generate_compliance_json(self, site_name, kpis, opportunities):
        """Produce a JSON export for EU compliance."""
        baseline_emissions = kpis.get("energy_kwh", 0) * 0.4
        projected_savings = sum(
            opp["est_co2_tons_saved_per_year"] for opp in opportunities
        )
        measures = [
            {
                "name": opp["name"],
                "description": opp["description"],
                "annual_kwh_saved": opp["est_annual_kwh_saved"],
                "annual_co2_saved_tons": opp["est_co2_tons_saved_per_year"],
                "roi_years": opp["simple_roi_years"],
            }
            for opp in opportunities
        ]
        export = {
            "site": site_name,
            "baseline_emissions_tons": baseline_emissions,
            "projected_savings_tons": projected_savings,
            "measures": measures,
        }
        return json.dumps(export, indent=2)