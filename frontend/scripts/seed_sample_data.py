import os
from sqlalchemy.orm import Session
from app.db.session import engine, SessionLocal
from app.models import Organization, Site, Sensor, Metric, User

def should_seed():
    db_url = os.environ.get("DATABASE_URL", "")
    force = os.environ.get("FORCE_SEED", "false").lower() == "true"
    return force or db_url.startswith("postgresql://localhost") or db_url.startswith("sqlite://")

def seed():
    db: Session = SessionLocal()
    try:
        # Organization
        org = Organization(name="Demo Org")
        db.add(org)
        db.flush()

        # Site
        site = Site(name="Demo Site", location="Berlin", org_id=org.id)
        db.add(site)
        db.flush()

        # Sensors
        sensor1 = Sensor(name="Electricity Meter", sensor_type="electricity", site_id=site.id)
        sensor2 = Sensor(name="Gas Meter", sensor_type="gas", site_id=site.id)
        db.add_all([sensor1, sensor2])
        db.flush()

        # Metrics
        from datetime import datetime, timedelta
        now = datetime.utcnow()
        metrics = [
            Metric(sensor_id=sensor1.id, ts=now, value=120.5),
            Metric(sensor_id=sensor1.id, ts=now - timedelta(hours=1), value=110.2),
            Metric(sensor_id=sensor2.id, ts=now, value=50.3),
        ]
        db.add_all(metrics)

        # User
        user = User(email="demo@org.com", hashed_password="notahash", org_id=org.id, role="admin")
        db.add(user)

        db.commit()
        print("Seeded demo data.")
    except Exception as e:
        db.rollback()
        print(f"Error seeding data: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    if should_seed():
        seed()
    else:
        print("Skipping seed: Not localhost and FORCE_SEED not set.")
