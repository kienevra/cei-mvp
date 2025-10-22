"""
# To include in app.main:
# from app.api.v1.upload_csv import router as upload_csv_router
# app.include_router(upload_csv_router)
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, status, Depends, BackgroundTasks, Query
from fastapi.security import OAuth2PasswordBearer
from typing import List, Optional
from uuid import uuid4
import csv
import os

# Replace with your actual auth dependency
from app.api.v1.auth import get_current_user

router = APIRouter(prefix="/api/v1", tags=["Upload CSV"])

UPLOAD_DIR = "/tmp/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

PREVIEW_ROWS = 10
REQUIRED_COLUMNS = {"timestamp", "site_id", "meter_id", "value", "unit"}

class PreviewResponseRowError:
    def __init__(self, row: int, message: str):
        self.row = row
        self.message = message


def process_csv_job(job_id: str):
    # Placeholder for real processing logic
    pass

@router.post("/upload-csv", status_code=status.HTTP_202_ACCEPTED)
async def upload_csv(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = Depends(),
    skip_header: bool = Query(False, description="Skip first row as header"),
    timezone: Optional[str] = Query(None, description="Timezone for timestamps"),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload a CSV file containing timeseries data. Validates first N rows and returns a preview.
    Requires Bearer token authentication.

    Example curl:
    curl -X POST "http://localhost:8000/api/v1/upload-csv" \
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
        delimiter = "," if file.filename.endswith(".csv") else "\t"
        with open(upload_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            columns = set(reader.fieldnames or [])
            missing = REQUIRED_COLUMNS - columns
            if missing:
                raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")
            for i, row in enumerate(reader):
                if i >= PREVIEW_ROWS:
                    break
                row_errors = []
                for col in REQUIRED_COLUMNS:
                    if not row.get(col):
                        row_errors.append(f"missing {col}")
                try:
                    float(row["value"])
                except Exception:
                    row_errors.append("invalid value")
                # Add more validation as needed
                if row_errors:
                    rejected_rows += 1
                    errors.append({"row": i+2 if skip_header else i+1, "message": "; ".join(row_errors)})
                else:
                    accepted_rows += 1
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {e}")
    # Schedule background job
    background_tasks.add_task(process_csv_job, job_id)
    return {
        "accepted_rows": accepted_rows,
        "rejected_rows": rejected_rows,
        "errors": errors,
        "job_id": job_id
    }
