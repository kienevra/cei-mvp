# backend/scripts/attach_dev_user_to_org.py

import sys
from pathlib import Path

# --- Ensure the backend root (where `app/` lives) is on sys.path ---
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import SessionLocal
from app.models import User, Organization


def main() -> None:
    db = SessionLocal()
    try:
        email = "dev@cei.local"

        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"[FAIL] No user found with email={email}")
            return

        # If already attached, don't do anything destructive
        if getattr(user, "organization_id", None):
            print(f"[OK] User already attached to org_id={user.organization_id}")
            return

        org = Organization(
            name="Dev Manufacturing (Local)",
            subscription_plan_key="cei-starter",
            subscription_status="active",
            enable_alerts=True,
            enable_reports=True,
        )
        db.add(org)
        db.flush()  # get org.id

        user.organization_id = org.id
        db.add(user)

        db.commit()
        print(f"[OK] Attached {email} to org_id={org.id} ({org.name})")

    finally:
        db.close()


if __name__ == "__main__":
    main()
