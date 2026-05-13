# backend/app/api/v1/production_integrations.py
"""
Production Integrations API
----------------------------
Manages production data source connectors per site.

Supported types:
  webhook    — factory POSTs daily production to a CEI endpoint (token auth)
  sap_b1     — pull from SAP Business One Service Layer
  teamsystem — pull from Teamsystem Alyante Enterprise

Endpoints:
  GET    /production-integrations/sites/{site_id}         list integrations
  POST   /production-integrations/sites/{site_id}         create integration
  DELETE /production-integrations/{integration_id}        delete integration
  POST   /production-integrations/{integration_id}/sync   manual sync (pull)
  POST   /production/webhook/{webhook_token}              receive webhook push
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.api.deps import require_owner
from app.db.session import get_db
from app.models import ProductionIntegration, ProductionRecord, Site
from app.core.security import get_org_context, OrgContext

logger = logging.getLogger("cei.prod_integrations")

router = APIRouter(tags=["production-integrations"])


# ── Encryption helpers ────────────────────────────────────────────────────────

def _fernet():
    from cryptography.fernet import Fernet
    from app.core.config import settings
    key = hashlib.sha256(settings.jwt_secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt(data: dict) -> str:
    return _fernet().encrypt(json.dumps(data).encode()).decode()


def _decrypt(token: str) -> dict:
    return json.loads(_fernet().decrypt(token.encode()).decode())


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateIntegrationRequest(BaseModel):
    integration_type: str          # "webhook" | "sap_b1" | "teamsystem"
    label:            Optional[str] = None
    config:           Optional[Dict[str, Any]] = None  # SAP/TS config params


class IntegrationOut(BaseModel):
    id:               int
    site_id:          int
    integration_type: str
    label:            Optional[str]
    webhook_url:      Optional[str]  # populated for webhook type
    is_active:        bool
    last_sync_at:     Optional[str]
    last_sync_status: Optional[str]
    last_sync_message:Optional[str]
    created_at:       str


class WebhookPushRequest(BaseModel):
    date:           str    # YYYY-MM-DD
    units_produced: float
    unit_label:     Optional[str] = "units"
    notes:          Optional[str] = None


class SyncResult(BaseModel):
    inserted: int
    updated:  int
    errors:   List[str]
    synced_at: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _integration_out(
    intg: ProductionIntegration,
    request: Optional[Request] = None,
) -> IntegrationOut:
    webhook_url = None
    if intg.integration_type == "webhook" and intg.webhook_token:
        base = ""
        if request:
            base = str(request.base_url).rstrip("/")
        webhook_url = f"{base}/api/v1/production/webhook/{intg.webhook_token}"

    return IntegrationOut(
        id=intg.id,
        site_id=intg.site_id,
        integration_type=intg.integration_type,
        label=intg.label,
        webhook_url=webhook_url,
        is_active=intg.is_active,
        last_sync_at=intg.last_sync_at.isoformat() if intg.last_sync_at else None,
        last_sync_status=intg.last_sync_status,
        last_sync_message=intg.last_sync_message,
        created_at=intg.created_at.isoformat(),
    )


def _assert_site_access(
    site_id: int,
    user,
    db: Session,
) -> Site:
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found.")
    org_id = getattr(user, "organization_id", None)
    if site.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    return site


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get(
    "/production-integrations/sites/{site_id}",
    response_model=List[IntegrationOut],
)
def list_integrations(
    site_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> List[IntegrationOut]:
    _assert_site_access(site_id, user, db)
    rows = (
        db.query(ProductionIntegration)
        .filter(
            ProductionIntegration.site_id == site_id,
            ProductionIntegration.is_active == True,
        )
        .order_by(ProductionIntegration.created_at.desc())
        .all()
    )
    return [_integration_out(r, request) for r in rows]


@router.post(
    "/production-integrations/sites/{site_id}",
    response_model=IntegrationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_integration(
    site_id: int,
    payload: CreateIntegrationRequest,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> IntegrationOut:
    site = _assert_site_access(site_id, user, db)
    require_owner(user, message="Only owners can configure integrations.")

    valid_types = {"webhook", "sap_b1", "teamsystem"}
    if payload.integration_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"integration_type must be one of: {', '.join(valid_types)}",
        )

    # Enforce one integration per type per site
    existing = (
        db.query(ProductionIntegration)
        .filter(
            ProductionIntegration.site_id == site_id,
            ProductionIntegration.integration_type == payload.integration_type,
            ProductionIntegration.is_active == True,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A {payload.integration_type} integration already exists for this site. Delete it first.",
        )

    intg = ProductionIntegration(
        organization_id=site.org_id,
        site_id=site_id,
        integration_type=payload.integration_type,
        label=payload.label or payload.integration_type.replace("_", " ").title(),
        is_active=True,
    )

    if payload.integration_type == "webhook":
        intg.webhook_token = secrets.token_urlsafe(32)

    elif payload.integration_type in ("sap_b1", "teamsystem"):
        if not payload.config:
            raise HTTPException(
                status_code=400,
                detail=f"config is required for {payload.integration_type} integration.",
            )
        required = {
            "sap_b1":     ["server_url", "company_db", "username", "password"],
            "teamsystem":  ["tenant_url", "client_id", "client_secret"],
        }[payload.integration_type]

        missing = [k for k in required if not payload.config.get(k)]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required config fields: {', '.join(missing)}",
            )
        intg.config_encrypted = _encrypt(payload.config)

    db.add(intg)
    db.commit()
    db.refresh(intg)

    logger.info(
        "Integration created site_id=%s type=%s id=%s",
        site_id, payload.integration_type, intg.id,
    )
    return _integration_out(intg, request)


@router.delete(
    "/production-integrations/{integration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_integration(
    integration_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> None:
    intg = db.query(ProductionIntegration).filter(
        ProductionIntegration.id == integration_id
    ).first()
    if not intg:
        raise HTTPException(status_code=404, detail="Integration not found.")

    org_id = getattr(user, "organization_id", None)
    if intg.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    require_owner(user, message="Only owners can delete integrations.")
    intg.is_active = False
    db.commit()
    logger.info("Integration deleted id=%s", integration_id)


@router.post(
    "/production-integrations/{integration_id}/sync",
    response_model=SyncResult,
)
def sync_integration(
    integration_id: int,
    days_back: int = 7,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> SyncResult:
    """
    Manually trigger a pull sync for SAP B1 or Teamsystem integrations.
    Not applicable for webhook type (webhook is push-based).
    """
    intg = db.query(ProductionIntegration).filter(
        ProductionIntegration.id == integration_id,
        ProductionIntegration.is_active == True,
    ).first()

    if not intg:
        raise HTTPException(status_code=404, detail="Integration not found.")

    org_id = getattr(user, "organization_id", None)
    if intg.organization_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    if intg.integration_type == "webhook":
        raise HTTPException(
            status_code=400,
            detail="Webhook integrations are push-based. No manual sync needed.",
        )

    if not intg.config_encrypted:
        raise HTTPException(status_code=400, detail="Integration has no config.")

    try:
        config = _decrypt(intg.config_encrypted)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt integration config.")

    inserted = updated = 0
    errors: List[str] = []

    if intg.integration_type == "sap_b1":
        from app.services.sap_b1 import sync_sap_b1
        inserted, updated, errors = sync_sap_b1(
            config=config,
            site_id=intg.site_id,
            organization_id=intg.organization_id,
            days_back=days_back,
        )
    elif intg.integration_type == "teamsystem":
        from app.services.teamsystem import sync_teamsystem
        inserted, updated, errors = sync_teamsystem(
            config=config,
            site_id=intg.site_id,
            organization_id=intg.organization_id,
            days_back=days_back,
        )

    now = datetime.now(timezone.utc)
    intg.last_sync_at      = now
    intg.last_sync_status  = "error" if errors else "ok"
    intg.last_sync_message = errors[0] if errors else f"{inserted} inserted, {updated} updated"
    db.commit()

    return SyncResult(
        inserted=inserted,
        updated=updated,
        errors=errors,
        synced_at=now.isoformat(),
    )


# ── Webhook receiver ──────────────────────────────────────────────────────────

@router.post(
    "/production/webhook/{webhook_token}",
    status_code=status.HTTP_200_OK,
    include_in_schema=True,
    summary="Receive production data via webhook (no user auth — token in URL)",
)
async def receive_webhook(
    webhook_token: str,
    payload: WebhookPushRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Public endpoint — authenticated by the webhook_token in the URL.

    The factory ERP/MES system POSTs daily production here on a schedule.
    No user session required.

    Example POST body:
      {
        "date": "2026-05-11",
        "units_produced": 4800,
        "unit_label": "pezzi"
      }
    """
    intg = (
        db.query(ProductionIntegration)
        .filter(
            ProductionIntegration.webhook_token == webhook_token,
            ProductionIntegration.is_active     == True,
            ProductionIntegration.integration_type == "webhook",
        )
        .first()
    )

    if not intg:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or inactive webhook token.",
        )

    # Parse and validate date
    try:
        record_date = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format: {payload.date!r}. Use YYYY-MM-DD.",
        )

    if payload.units_produced < 0:
        raise HTTPException(status_code=400, detail="units_produced must be >= 0.")

    # Upsert production record
    existing = (
        db.query(ProductionRecord)
        .filter(
            ProductionRecord.site_id == intg.site_id,
            ProductionRecord.date    == record_date,
        )
        .first()
    )

    action = "updated"
    if existing:
        existing.units_produced = payload.units_produced
        if payload.unit_label:
            existing.unit_label = payload.unit_label
        if payload.notes:
            existing.notes = payload.notes
    else:
        action = "inserted"
        db.add(ProductionRecord(
            organization_id=intg.organization_id,
            site_id=intg.site_id,
            date=record_date,
            units_produced=payload.units_produced,
            unit_label=payload.unit_label or "units",
            notes=payload.notes or "Webhook push",
        ))

    now = datetime.now(timezone.utc)
    intg.last_sync_at      = now
    intg.last_sync_status  = "ok"
    intg.last_sync_message = f"Webhook {action} {record_date}"

    db.commit()

    logger.info(
        "Webhook received site_id=%s date=%s units=%.1f action=%s",
        intg.site_id, record_date, payload.units_produced, action,
    )

    return {
        "status":  "ok",
        "action":  action,
        "site_id": intg.site_id,
        "date":    str(record_date),
        "units_produced": payload.units_produced,
    }


class ProductionRecordIn(BaseModel):
    """Single production record for API ingest."""
    site_id:        str
    date:           str            # YYYY-MM-DD
    units_produced: float
    unit_label:     Optional[str] = "units"
    notes:          Optional[str] = None


class ProductionBatchRequest(BaseModel):
    records: List[ProductionRecordIn]


class ProductionIngestResponse(BaseModel):
    inserted: int
    updated:  int
    skipped:  int
    errors:   List[str]


def _parse_site_numeric_id(site_id: str) -> Optional[int]:
    """Convert 'site-1' or '1' to integer 1."""
    s = (site_id or "").strip()
    if s.startswith("site-"):
        try:
            return int(s.split("site-")[-1])
        except ValueError:
            return None
    try:
        return int(s)
    except ValueError:
        return None


def _validate_site_access(
    db: Session,
    org_id: int,
    site_id_raw: str,
) -> int:
    """
    Validates the site belongs to the org.
    Returns the numeric site ID.
    Raises 404 if not found (avoids leaking existence).
    """
    from app.models import Site as SiteModel

    numeric_id = _parse_site_numeric_id(site_id_raw)
    if numeric_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid site_id format: {site_id_raw!r}. Use 'site-1' or '1'.",
        )

    site = (
        db.query(SiteModel)
        .filter(SiteModel.id == numeric_id, SiteModel.org_id == org_id)
        .first()
    )
    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site not found.",
        )

    return numeric_id


@router.post(
    "/production/ingest",
    response_model=ProductionIngestResponse,
    status_code=status.HTTP_200_OK,
    summary="Ingest a single production record via CEI integration token",
)
def ingest_production_record(
    payload: ProductionRecordIn,
    db:      Session = Depends(get_db),
    org_ctx          = Depends(get_org_context),
) -> ProductionIngestResponse:
    """
    Push a single daily production record using a CEI integration token.

    Accepts the same `cei_int_...` token used for energy timeseries push —
    one token covers both data streams.

    **Example:**
    ```
    POST /api/v1/production/ingest
    Authorization: Bearer cei_int_...

    {
      "site_id":        "site-1",
      "date":           "2026-05-11",
      "units_produced": 4800,
      "unit_label":     "pezzi"
    }
    ```

    Idempotent: existing records for the same (site, date) are updated.
    """
    from app.models import ProductionRecord as PR

    org_id = int(getattr(org_ctx, "organization_id"))

    numeric_site_id = _validate_site_access(db, org_id, payload.site_id)

    try:
        record_date = date.fromisoformat(payload.date)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid date format: {payload.date!r}. Use YYYY-MM-DD.",
        )

    if payload.units_produced < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="units_produced must be >= 0.",
        )

    existing = (
        db.query(PR)
        .filter(PR.site_id == numeric_site_id, PR.date == record_date)
        .first()
    )

    if existing:
        existing.units_produced = payload.units_produced
        if payload.unit_label:
            existing.unit_label = payload.unit_label
        if payload.notes:
            existing.notes = payload.notes
        db.commit()
        return ProductionIngestResponse(inserted=0, updated=1, skipped=0, errors=[])
    else:
        db.add(PR(
            organization_id=org_id,
            site_id=numeric_site_id,
            date=record_date,
            units_produced=payload.units_produced,
            unit_label=payload.unit_label or "units",
            notes=payload.notes or "API ingest",
        ))
        db.commit()
        return ProductionIngestResponse(inserted=1, updated=0, skipped=0, errors=[])


@router.post(
    "/production/ingest/batch",
    response_model=ProductionIngestResponse,
    status_code=status.HTTP_200_OK,
    summary="Batch ingest production records via CEI integration token",
)
def ingest_production_batch(
    payload: ProductionBatchRequest,
    db:      Session = Depends(get_db),
    org_ctx          = Depends(get_org_context),
) -> ProductionIngestResponse:
    """
    Push multiple daily production records in a single call.

    Accepts the same `cei_int_...` token used for energy timeseries push.
    Records for different sites can be mixed in the same batch.

    **Example:**
    ```
    POST /api/v1/production/ingest/batch
    Authorization: Bearer cei_int_...

    {
      "records": [
        {"site_id": "site-1", "date": "2026-05-11", "units_produced": 4800, "unit_label": "pezzi"},
        {"site_id": "site-1", "date": "2026-05-12", "units_produced": 5100, "unit_label": "pezzi"},
        {"site_id": "site-2", "date": "2026-05-11", "units_produced": 3900, "unit_label": "pezzi"}
      ]
    }
    ```

    Returns counts of inserted, updated, and skipped records.
    Row-level errors are collected and returned without aborting the batch.
    """
    from app.models import ProductionRecord as PR

    org_id = int(getattr(org_ctx, "organization_id"))

    if not payload.records:
        return ProductionIngestResponse(inserted=0, updated=0, skipped=0, errors=[])

    if len(payload.records) > 1000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch limit is 1,000 records per request.",
        )

    # Cache validated site IDs to avoid repeated DB lookups
    site_cache: dict = {}
    inserted = updated = skipped = 0
    errors: List[str] = []

    for i, rec in enumerate(payload.records):
        row_label = f"Row {i + 1} (site={rec.site_id} date={rec.date})"
        try:
            # Validate and cache site
            if rec.site_id not in site_cache:
                try:
                    site_cache[rec.site_id] = _validate_site_access(db, org_id, rec.site_id)
                except HTTPException as exc:
                    errors.append(f"{row_label}: {exc.detail}")
                    skipped += 1
                    continue

            numeric_site_id = site_cache[rec.site_id]

            # Parse date
            try:
                record_date = date.fromisoformat(rec.date)
            except ValueError:
                errors.append(f"{row_label}: invalid date format, expected YYYY-MM-DD")
                skipped += 1
                continue

            if rec.units_produced < 0:
                errors.append(f"{row_label}: units_produced must be >= 0")
                skipped += 1
                continue

            # Upsert
            existing = (
                db.query(PR)
                .filter(PR.site_id == numeric_site_id, PR.date == record_date)
                .first()
            )

            if existing:
                existing.units_produced = rec.units_produced
                if rec.unit_label:
                    existing.unit_label = rec.unit_label
                if rec.notes:
                    existing.notes = rec.notes
                updated += 1
            else:
                db.add(PR(
                    organization_id=org_id,
                    site_id=numeric_site_id,
                    date=record_date,
                    units_produced=rec.units_produced,
                    unit_label=rec.unit_label or "units",
                    notes=rec.notes or "API batch ingest",
                ))
                inserted += 1

        except Exception as exc:
            logger.exception("Unexpected error at %s", row_label)
            errors.append(f"{row_label}: unexpected error — {exc}")
            skipped += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Batch commit failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database commit failed: {exc}",
        )

    logger.info(
        "Production batch ingest org_id=%s inserted=%s updated=%s skipped=%s errors=%s",
        org_id, inserted, updated, skipped, len(errors),
    )

    return ProductionIngestResponse(
        inserted=inserted,
        updated=updated,
        skipped=skipped,
        errors=errors,
    )