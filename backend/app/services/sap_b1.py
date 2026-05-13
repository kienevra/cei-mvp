# backend/app/services/sap_b1.py
"""
SAP Business One — Production Data Connector
---------------------------------------------
Connects to SAP B1 Service Layer REST API to pull daily production quantities.

Tested against SAP B1 Service Layer v2 (B1 9.x / 10.x).
The factory IT admin must:
  1. Enable Service Layer on their SAP B1 server
  2. Create a dedicated read-only API user
  3. Provide: server URL, company DB name, username, password

Service Layer default port: 50000 (HTTP) or 50001 (HTTPS)
Auth: session cookie (B1SESSION) returned from /b1s/v1/Login

NOTE: Field names below are standard SAP B1 Service Layer.
If the factory runs a heavily customised B1, the production order
field names may differ — check with their B1 consultant.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import List, Optional, Tuple

import requests

logger = logging.getLogger("cei.sap_b1")

# ── Config keys stored in ProductionIntegration.config_encrypted ─────────────
# {
#   "server_url": "https://192.168.1.100:50000",   # no trailing slash
#   "company_db": "MYCOMPANY",
#   "username":   "CEI_API_USER",
#   "password":   "secret",
#   "item_code":  "CERAMICTILE",                    # optional filter by item
#   "verify_ssl": false                             # set true in production
# }

REQUEST_TIMEOUT = (10, 30)  # (connect, read)


class SapB1Client:
    """
    Thin session-based client for SAP B1 Service Layer.
    Use as a context manager to ensure logout.
    """

    def __init__(self, config: dict):
        self.base = config["server_url"].rstrip("/")
        self.company_db = config["company_db"]
        self.username   = config["username"]
        self.password   = config["password"]
        self.item_code  = config.get("item_code")
        self.verify_ssl = config.get("verify_ssl", False)
        self._session   = requests.Session()
        self._logged_in = False

    # ── Auth ──────────────────────────────────────────────────────────────────

    def login(self) -> None:
        resp = self._session.post(
            f"{self.base}/b1s/v1/Login",
            json={
                "CompanyDB": self.company_db,
                "UserName":  self.username,
                "Password":  self.password,
            },
            verify=self.verify_ssl,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        # SAP B1 sets B1SESSION cookie automatically via requests.Session
        self._logged_in = True
        logger.info("SAP B1 login OK company=%s", self.company_db)

    def logout(self) -> None:
        if not self._logged_in:
            return
        try:
            self._session.post(
                f"{self.base}/b1s/v1/Logout",
                verify=self.verify_ssl,
                timeout=(5, 10),
            )
        except Exception:
            pass
        self._logged_in = False

    def __enter__(self):
        self.login()
        return self

    def __exit__(self, *_):
        self.logout()

    # ── Production orders ─────────────────────────────────────────────────────

    def get_daily_production(
        self,
        start: date,
        end: date,
    ) -> List[dict]:
        """
        Query completed production orders between start and end (inclusive).

        Returns list of:
          { "date": date, "units_produced": float, "item_code": str }

        SAP B1 Production Order fields used:
          PostingDate   — the date the order was posted/completed
          CmpltQty      — completed quantity (units actually produced)
          PlannedQuantity — fallback if CmpltQty is 0
          ItemCode      — the finished good item code
          Status        — "R" = released, "L" = closed (completed)

        Groups by date and sums quantities across all orders for that day.
        """
        start_str = f"{start.isoformat()}T00:00:00Z"
        end_str   = f"{end.isoformat()}T23:59:59Z"

        # Build OData filter
        filters = [
            f"PostingDate ge '{start_str}'",
            f"PostingDate le '{end_str}'",
            "Status eq 'L'",  # L = closed/completed
        ]
        if self.item_code:
            filters.append(f"ItemCode eq '{self.item_code}'")

        odata_filter = " and ".join(filters)

        select_fields = "DocEntry,PostingDate,ItemCode,CmpltQty,PlannedQuantity,Status"

        url = f"{self.base}/b1s/v1/ProductionOrders"
        params = {
            "$filter": odata_filter,
            "$select": select_fields,
            "$top":    "500",
        }

        rows = []
        while url:
            resp = self._session.get(
                url,
                params=params,
                verify=self.verify_ssl,
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()

            rows.extend(data.get("value", []))

            # OData pagination
            url = data.get("odata.nextLink") or data.get("@odata.nextLink")
            params = {}  # params already encoded in nextLink

        return _aggregate_by_date(rows)


def _aggregate_by_date(rows: List[dict]) -> List[dict]:
    """
    Group SAP production order rows by date, summing quantities.
    Uses CmpltQty (completed) with fallback to PlannedQuantity.
    """
    from collections import defaultdict

    daily: dict = defaultdict(lambda: {"units": 0.0, "item_code": ""})

    for row in rows:
        raw_date = row.get("PostingDate", "")
        # SAP returns ISO datetime strings like "2026-04-01T00:00:00Z"
        try:
            d = date.fromisoformat(raw_date[:10])
        except ValueError:
            continue

        qty = float(row.get("CmpltQty") or row.get("PlannedQuantity") or 0)
        if qty <= 0:
            continue

        daily[d]["units"] += qty
        daily[d]["item_code"] = row.get("ItemCode", "")

    return [
        {
            "date":           d,
            "units_produced": round(v["units"], 2),
            "item_code":      v["item_code"],
        }
        for d, v in sorted(daily.items())
    ]


# ── Public sync function ──────────────────────────────────────────────────────

def sync_sap_b1(
    config: dict,
    site_id: int,
    organization_id: int,
    days_back: int = 7,
) -> Tuple[int, int, List[str]]:
    """
    Pull production data from SAP B1 and upsert into production_record.

    Returns (inserted, updated, errors).
    Called from the production_integrations sync endpoint.
    """
    from app.db.session import SessionLocal
    from app.models import ProductionRecord

    end   = date.today()
    start = end - timedelta(days=days_back)

    errors: List[str] = []

    try:
        with SapB1Client(config) as client:
            daily_rows = client.get_daily_production(start, end)
    except Exception as exc:
        logger.exception("SAP B1 pull failed site_id=%s", site_id)
        return 0, 0, [f"SAP B1 connection error: {exc}"]

    if not daily_rows:
        return 0, 0, []

    db = SessionLocal()
    inserted = updated = 0

    try:
        for row in daily_rows:
            existing = (
                db.query(ProductionRecord)
                .filter(
                    ProductionRecord.site_id == site_id,
                    ProductionRecord.date    == row["date"],
                )
                .first()
            )
            if existing:
                existing.units_produced = row["units_produced"]
                updated += 1
            else:
                db.add(ProductionRecord(
                    organization_id=organization_id,
                    site_id=site_id,
                    date=row["date"],
                    units_produced=row["units_produced"],
                    unit_label=config.get("unit_label", "units"),
                    notes=f"SAP B1 sync · {row['item_code']}",
                ))
                inserted += 1

        db.commit()
        logger.info(
            "SAP B1 sync complete site_id=%s inserted=%s updated=%s",
            site_id, inserted, updated,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("SAP B1 DB upsert failed site_id=%s", site_id)
        errors.append(f"DB error: {exc}")
    finally:
        db.close()

    return inserted, updated, errors