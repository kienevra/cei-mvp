# backend/app/db/models.py

from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func

from app.db.base import Base


class AlertEvent(Base):
    __tablename__ = "alert_events"

    id = Column(Integer, primary_key=True, index=True)

    # Underlying DB column is "org_id"
    organization_id = Column("org_id", Integer, index=True, nullable=True)

    site_id = Column(String(128), index=True, nullable=True)
    rule_key = Column(String(128), nullable=False, index=True)
    severity = Column(String(32), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    metric = Column(String(128), nullable=True)
    window_hours = Column(Integer, nullable=False)
    triggered_at = Column(DateTime(timezone=True), nullable=False, index=True)

    # Workflow fields used by /alerts/history and PATCH /alerts/{id}
    # These must exist in the DB (see migration in Step 2).
    status = Column(String(32), nullable=False, default="open", server_default="open")
    owner_user_id = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class SiteEvent(Base):
    __tablename__ = "site_events"

    id = Column(Integer, primary_key=True, index=True)

    # Underlying DB column is "org_id"
    organization_id = Column("org_id", Integer, index=True, nullable=True)

    site_id = Column(String(128), index=True, nullable=True)

    # Underlying DB column is "kind"
    type = Column("kind", String(64), nullable=False, index=True)

    related_alert_id = Column(Integer, nullable=True)

    title = Column(String(255), nullable=False)

    # Underlying DB column is "description"
    body = Column("description", Text, nullable=True)

    # New column to support "created_by_user_id" in your workflow
    created_by_user_id = Column(Integer, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
