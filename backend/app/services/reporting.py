from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from io import BytesIO
import json

class ReportingService:
    def __init__(self):
        pass

    def generate_pdf_report(self, site_name, kpis, opportunities):
        """
        Generate a one-page PDF summarizing KPIs, ranked opportunities, ROI, and CO2 savings.
        Returns PDF bytes.
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
            c.drawString(70, y, f"{i}. {opp['name']} - ROI: {opp['simple_roi_years']:.2f} yrs, CO2 Saved: {opp['est_co2_tons_saved_per_year']:.2f} t")

        c.showPage()
        c.save()
        buffer.seek(0)
        return buffer.read()

    def generate_compliance_json(self, site_name, kpis, opportunities):
        """
        Produce a JSON export for EU compliance.
        """
        baseline_emissions = kpis.get("energy_kwh", 0) * 0.4  # Example emission factor
        projected_savings = sum([opp["est_co2_tons_saved_per_year"] for opp in opportunities])
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
