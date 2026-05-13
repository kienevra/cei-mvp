# backend/app/services/teamsystem.py
"""
Teamsystem Alyante — Production Data Connector
-----------------------------------------------
Connects to Teamsystem Alyante Enterprise REST API to pull daily
production quantities.

Auth: OAuth2 client credentials flow.
The factory IT admin must:
  1. Enable API access in Teamsystem Alyante back-office
  2. Create an API client (client_id + client_secret)
  3. Provide: tenant URL, client_id, client_secret, company code

NOTE: Teamsystem Alyante's production module endpoint paths and
response shapes vary by version (v3.x vs v4.x). The endpoints below
match Alyante Enterprise v4.x. For older versions, check with the
factory's Teamsystem reseller for the correct paths.

If the factory runs Teamsystem GAMMA or another product line, the
auth flow is the same but the production endpoint path will differ.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import List, Tuple

import requests

logger = logging.getLogger("cei.teamsystem")

# ── Config keys stored in ProductionIntegration.config_encrypted ─────────────
# {
#   "tenant_url":    "https://mycompany.alyante.cloud",  # no trailing slash
#   "client_id":     "abc123",
#   "client_secret": "secret",
#   "company_code":  "01",           # Teamsystem company/branch code
#   "item_filter":   "TILES%",       # optional SQL-LIKE filter on item code
#   "unit_label":    "pezzi",
#   "verify_ssl":    true
# }

REQUEST_TIMEOUT = (10, 30)


class TeamsystemClient:
    """
    OAuth2 client for Teamsystem Alyante Enterprise REST API.
    Use as a context manager.
    """

    def __init__(self, config: dict):
        self.base          = config["tenant_url"].rstrip("/")
        self.client_id     = config["client_id"]
        self.client_secret = config["client_secret"]
        self.company_code  = config.get("company_code", "01")
        self.item_filter   = config.get("item_filter")
        self.verify_ssl    = config.get("verify_ssl", True)
        self._token: str   = ""
        self._session      = requests.Session()

    # ── Auth ──────────────────────────────────────────────────────────────────

    def _get_token(self) -> None:
        resp = self._session.post(
            f"{self.base}/oauth/token",
            data={
                "grant_type":    "client_credentials",
                "client_id":     self.client_id,
                "client_secret": self.client_secret,
            },
            headers={"Accept": "application/json"},
            verify=self.verify_ssl,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        self._token = resp.json()["access_token"]
        self._session.headers.update({
            "Authorization": f"Bearer {self._token}",
            "Accept":        "application/json",
            "X-Company":     self.company_code,
        })
        logger.info("Teamsystem auth OK tenant=%s", self.base)

    def __enter__(self):
        self._get_token()
        return self

    def __exit__(self, *_):
        self._session.headers.pop("Authorization", None)

    # ── Production data ───────────────────────────────────────────────────────

    def get_daily_production(
        self,
        start: date,
        end: date,
    ) -> List[dict]:
        """
        Pull completed production orders between start and end (inclusive).

        Teamsystem Alyante v4 endpoint:
          GET /api/v1/production/orders

        Query parameters:
          dateFrom    YYYY-MM-DD
          dateTo      YYYY-MM-DD
          status      COMPLETED
          pageSize    200
          page        1

        Response shape (v4):
          {
            "data": [
              {
                "completionDate": "2026-04-01",
                "itemCode": "TILE-A",
                "itemDescription": "Ceramic Tile A",
                "completedQuantity": 4800.0,
                "unitOfMeasure": "PZ"
              },
              ...
            ],
            "totalCount": 42,
            "page": 1,
            "pageSize": 200
          }

        NOTE: If your Alyante version returns a different shape, update
        the field names in _aggregate_ts_rows() below.
        """
        params = {
            "dateFrom": start.isoformat(),
            "dateTo":   end.isoformat(),
            "status":   "COMPLETED",
            "pageSize": 200,
            "page":     1,
        }
        if self.item_filter:
            params["itemCode"] = self.item_filter

        rows = []
        while True:
            resp = self._session.get(
                f"{self.base}/api/v1/production/orders",
                params=params,
                verify=self.verify_ssl,
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            body = resp.json()

            batch = body.get("data", [])
            rows.extend(batch)

            total     = int(body.get("totalCount", 0))
            page_size = int(body.get("pageSize", 200))
            page      = int(body.get("page", 1))

            if page * page_size >= total:
                break
            params["page"] = page + 1

        return _aggregate_ts_rows(rows)


def _aggregate_ts_rows(rows: List[dict]) -> List[dict]:
    """
    Group Teamsystem production rows by completionDate, summing quantities.

    Field names match Alyante Enterprise v4. Adjust if your version differs:
      v3.x uses "productionDate" instead of "completionDate"
      v3.x uses "quantity" instead of "completedQuantity"
    """
    from collections import defaultdict

    daily: dict = defaultdict(lambda: {"units": 0.0, "item_code": ""})

    for row in rows:
        raw_date = row.get("completionDate") or row.get("productionDate", "")
        try:
            d = date.fromisoformat(raw_date[:10])
        except (ValueError, TypeError):
            continue

        qty = float(
            row.get("completedQuantity")
            or row.get("quantity")
            or 0
        )
        if qty <= 0:
            continue

        daily[d]["units"] += qty
        daily[d]["item_code"] = row.get("itemCode", "")

    return [
        {
            "date":           d,
            "units_produced": round(v["units"], 2),
            "item_code":      v["item_code"],
        }
        for d, v in sorted(daily.items())
    ]


# ── Public sync function ──────────────────────────────────────────────────────

def sync_teamsystem(
    config: dict,
    site_id: int,
    organization_id: int,
    days_back: int = 7,
) -> Tuple[int, int, List[str]]:
    """
    Pull production data from Teamsystem and upsert into production_record.

    Returns (inserted, updated, errors).
    """
    from app.db.session import SessionLocal
    from app.models import ProductionRecord

    end   = date.today()
    start = end - timedelta(days=days_back)
    errors: List[str] = []

    try:
        with TeamsystemClient(config) as client:
            daily_rows = client.get_daily_production(start, end)
    except Exception as exc:
        logger.exception("Teamsystem pull failed site_id=%s", site_id)
        return 0, 0, [f"Teamsystem connection error: {exc}"]

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
                    unit_label=config.get("unit_label", "pezzi"),
                    notes=f"Teamsystem sync · {row['item_code']}",
                ))
                inserted += 1

        db.commit()
        logger.info(
            "Teamsystem sync complete site_id=%s inserted=%s updated=%s",
            site_id, inserted, updated,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Teamsystem DB upsert failed site_id=%s", site_id)
        errors.append(f"DB error: {exc}")
    finally:
        db.close()

    return inserted, updated, errors