from backend.app.db.session import SessionLocal
from backend.app.db.models import TimeseriesRecord, StagingUpload
from sqlalchemy import func

db = SessionLocal()

# 1️⃣ Null org_id count
null_orgs = db.query(func.count()).filter(TimeseriesRecord.organization_id == None).scalar()
print("TimeseriesRecord rows with NULL org_id:", null_orgs)

# 2️⃣ Duplicate idempotency_key per org
duplicates = (
    db.query(TimeseriesRecord.organization_id, TimeseriesRecord.idempotency_key, func.count())
    .filter(TimeseriesRecord.idempotency_key != None)
    .group_by(TimeseriesRecord.organization_id, TimeseriesRecord.idempotency_key)
    .having(func.count() > 1)
    .all()
)
print("Duplicate idempotency_key per org:", duplicates)

# 3️⃣ Pending staging uploads
staging_pending = db.query(func.count()).filter(StagingUpload.status == "pending").scalar()
print("Pending staging_upload rows:", staging_pending)

db.close()
