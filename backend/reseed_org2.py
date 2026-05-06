from datetime import datetime, timedelta, timezone
from app.db.session import SessionLocal
from app.models import TimeseriesRecord
import random

db = SessionLocal()
now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

deleted = db.query(TimeseriesRecord).filter(
    TimeseriesRecord.organization_id == 2
).delete()
print(f"Deleted {deleted} old records")

def get_value(ts, site_idx):
    hour = ts.hour
    dow = ts.weekday()
    base_mult = [1.0, 1.05, 0.98, 1.02, 1.0, 0.6, 0.4][dow]
    if hour in range(22, 24) or hour in range(0, 6):
        base = 380.0 if dow in (1, 2) else 112.5
    elif hour in range(6, 8):
        base = 450.0
    elif hour in range(8, 18):
        base = 825.0 + (site_idx * 75)
    elif hour in range(18, 22):
        base = 975.0 + (site_idx * 50)
    else:
        base = 112.5
    return round(base * base_mult * random.uniform(0.93, 1.07), 1)

sites = ["site-1", "site-2", "site-3"]
records = []
hours = 30 * 24
start = now - timedelta(hours=hours)

for site_idx, site_id in enumerate(sites):
    for i in range(hours):
        ts = start + timedelta(hours=i)
        records.append(TimeseriesRecord(
            site_id=site_id,
            meter_id=f"{site_id}-meter",
            organization_id=2,
            timestamp=ts,
            value=get_value(ts, site_idx),
            unit="kWh",
            source="demo_reseed",
        ))

db.bulk_save_objects(records)
db.commit()
print(f"Inserted {len(records)} records for org 2 across {len(sites)} sites")
db.close()