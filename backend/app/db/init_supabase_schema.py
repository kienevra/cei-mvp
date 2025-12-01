# backend/app/db/init_supabase_schema.py

from app.db.session import engine
from app.db.base import Base

# Import all models so they are registered on Base.metadata
from app import models as core_models  # Organization, User, Site, Sensor, etc.
from app.db import models as alert_models  # AlertEvent, SiteEvent, etc.


def main() -> None:
    print("[init_supabase_schema] Creating any missing tables in Supabase...")
    Base.metadata.create_all(bind=engine)
    print("[init_supabase_schema] Done.")


if __name__ == "__main__":
    main()
