import csv
from datetime import datetime, timedelta
import random

# Generate sample sensor readings for demo
SENSOR_ID = 1
NUM_RECORDS = 48
FILENAME = "sample_metrics.csv"

now = datetime.utcnow()
rows = []
for i in range(NUM_RECORDS):
    ts = (now - timedelta(hours=NUM_RECORDS - i)).isoformat()
    value = round(random.uniform(50, 150), 2)
    rows.append({"sensor_id": SENSOR_ID, "ts": ts, "value": value})

with open(FILENAME, "w", newline="") as csvfile:
    fieldnames = ["sensor_id", "ts", "value"]
    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)

print(f"Sample CSV written to {FILENAME}")
