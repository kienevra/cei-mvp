# Generating Reports Locally

To generate a site report PDF and EU compliance JSON:

1. Run the backend and ensure your database is seeded.
2. Use the API endpoint to generate and download a PDF:
   ```
   curl -X POST http://localhost:8000/api/v1/sites/{site_id}/reports --output site_report.pdf
   ```
3. To generate a compliance JSON, use the `ReportingService.generate_compliance_json()` method in your code.

The PDF summarizes KPIs, ranked opportunities, ROI, and CO₂ savings. The JSON export matches EU reporting requirements.
