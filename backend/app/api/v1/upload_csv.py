# backend/app/api/v1/upload_csv.py
"""
Upload CSV endpoint (with real authentication).
Include in app.main as:
    from app.api.v1.upload_csv import router as upload_csv_router
    app.include_router(upload_csv_router, prefix="/api/v1")
"""

from fastapi import (
    APIRouter,
    UploadFile,
    File,
    HTTPException,
    status,
    BackgroundTasks,
    Query,
    Depends,
)
from typing import Optional
from uuid import uuid4
import csv
import os

# real auth dependency
from app.api.v1.auth import get_current_user

router = APIRouter(tags=["Upload CSV"])

UPLOAD_DIR = "/tmp/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

PREVIEW_ROWS = 10
REQUIRED_COLUMNS = {"timestamp", "site_id", "meter_id", "value", "unit"}

# Aliases: if canonical column missing, try these alternatives (lower-cased)
ALIASES = {
    "site_id": ["site_id", "sensor_id", "site"],
    "meter_id": ["meter_id", "sensor_id", "meter"],
    "timestamp": ["timestamp", "time", "ts"],
    "value": ["value", "reading", "val"],
    "unit": ["unit", "units"],
}


def _normalize_fieldnames(fieldnames):
    if not fieldnames:
        return []
    return [f.strip().lower() for f in fieldnames]


def _build_column_map(fieldnames_norm):
    """
    Given normalized fieldnames (list), return a mapping canonical_col -> actual_header_name (normalized)
    This attempts to resolve aliases. Returns dict where value is the matched normalized name.
    """
    col_map = {}
    for canonical, alias_list in ALIASES.items():
        for a in alias_list:
            if a in fieldnames_norm:
                col_map[canonical] = a
                break
    return col_map


def process_csv_job(job_id: str):
    # Placeholder for real processing logic
    # You should implement job queue / DB ingestion here.
    pass


@router.post("/upload-csv", status_code=status.HTTP_202_ACCEPTED)
async def upload_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    skip_header: bool = Query(False, description="Skip first row as header"),
    timezone: Optional[str] = Query(None, description="Timezone for timestamps"),
):
    """
    Upload a CSV file containing timeseries data. Validates first N rows and returns a preview.
    Requires Bearer token authentication (Depends(get_current_user)).

    Example curl:
    curl -X POST "https://<your-backend>/api/v1/upload-csv" \
      -H "Authorization: Bearer <token>" \
      -F "file=@data.csv"
    """
    job_id = str(uuid4())
    accepted_rows = 0
    rejected_rows = 0
    errors = []
    preview_rows = []

    # Save uploaded file to staging area
    upload_path = os.path.join(UPLOAD_DIR, f"{job_id}.csv")
    try:
        with open(upload_path, "wb") as out_file:
            content = await file.read()
            out_file.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Parse and validate first N rows
    try:
        # choose delimiter based on extension (fall back to comma)
        delimiter = "," if (file.filename and file.filename.lower().endswith(".csv")) else ","
        with open(upload_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            fieldnames = reader.fieldnames
            fieldnames_norm = _normalize_fieldnames(fieldnames)

            if not fieldnames_norm:
                raise HTTPException(status_code=400, detail="CSV has no header row or empty file.")

            col_map = _build_column_map(fieldnames_norm)

            # Attempt to auto-fill missing canonical columns using aliases / sensor_id
            missing_after_map = REQUIRED_COLUMNS - set(col_map.keys())

            # If unit missing, we will accept and populate empty string later (so remove from missing)
            if "unit" in missing_after_map:
                missing_after_map.remove("unit")  # allow missing unit; will default to ""

            if missing_after_map:
                # Try a last-ditch: if 'sensor_id' exists in the file, map it to site_id & meter_id if either missing
                if "sensor_id" in fieldnames_norm:
                    sensor_key = "sensor_id"
                    if "site_id" not in col_map:
                        col_map["site_id"] = sensor_key
                    if "meter_id" not in col_map:
                        col_map["meter_id"] = sensor_key
                    # recompute missing
                    missing_after_map = REQUIRED_COLUMNS - set(col_map.keys())
                    if "unit" in missing_after_map:
                        missing_after_map.remove("unit")

            if missing_after_map:
                # still missing required columns (other than unit)
                raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(sorted(missing_after_map))}")

            # iterate rows for preview
            for i, row in enumerate(reader):
                if i >= PREVIEW_ROWS:
                    break

                # normalize keys & values
                row_norm = {}
                for k, v in row.items():
                    if k is None:
                        continue
                    kn = k.strip().lower()
                    row_norm[kn] = v.strip() if isinstance(v, str) else v

                # create canonical access dict
                canonical_row = {}
                for canonical in REQUIRED_COLUMNS:
                    if canonical in col_map:
                        key = col_map[canonical]
                        val = row_norm.get(key, "")
                        canonical_row[canonical] = val if val is not None else ""
                    else:
                        # unit may be absent intentionally
                        canonical_row[canonical] = "" if canonical == "unit" else None

                # Basic validations
                row_errors = []
                if not canonical_row.get("timestamp"):
                    row_errors.append("missing timestamp")
                if not canonical_row.get("site_id"):
                    row_errors.append("missing site_id")
                if not canonical_row.get("meter_id"):
                    row_errors.append("missing meter_id")
                if not canonical_row.get("value"):
                    row_errors.append("missing value")
                else:
                    try:
                        float(canonical_row["value"])
                    except Exception:
                        row_errors.append("invalid value")

                if row_errors:
                    rejected_rows += 1
                    reported_row = i + 2 if (not skip_header) else i + 1
                    errors.append({"row": reported_row, "message": "; ".join(row_errors)})
                else:
                    accepted_rows += 1
                    preview_rows.append({k: canonical_row.get(k) for k in sorted(REQUIRED_COLUMNS)})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {e}")

    # Schedule background job
    background_tasks.add_task(process_csv_job, job_id)

    return {
        "accepted_rows": accepted_rows,
        "rejected_rows": rejected_rows,
        "errors": errors,
        "preview_rows": preview_rows,
        "job_id": job_id,
    }
