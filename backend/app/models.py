# backend/app/models.py
import sqlalchemy as sa
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    ForeignKey,
    Text,
    Index,
    DateTime,
    Numeric,
    Boolean,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import text
from app.db.base import Base

# Cross-DB timestamp default (SQLite + Postgres)
DB_NOW = text("CURRENT_TIMESTAMP")


class Organization(Base):
    __tablename__ = "organization"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)

    # ✅ Cross-DB default (fixes SQLite "now()" issues)
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    sites = relationship("Site", back_populates="organization", cascade="all, delete-orphan")
    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")

    # ✅ Invite links (owner-generated; per-email invites)
    invites = relationship("OrgInvite", back_populates="organization", cascade="all, delete-orphan")

    # -------- SaaS / billing fields --------
    plan_key = Column(String(64), nullable=True)                 # e.g. "free", "cei-starter"
    subscription_plan_key = Column(String(64), nullable=True)    # logical/Stripe plan key
    subscription_status = Column(String(32), nullable=True)      # e.g. "active", "past_due"

    # ✅ Cross-DB boolean defaults (SQLite-safe + Postgres-safe)
    enable_alerts = Column(Boolean, nullable=False, default=True, server_default=sa.true())
    enable_reports = Column(Boolean, nullable=False, default=True, server_default=sa.true())

    stripe_customer_id = Column(String(255), nullable=True)
    stripe_subscription_id = Column(String(255), nullable=True)
    stripe_status = Column(String(64), nullable=True)

    billing_email = Column(String(255), nullable=True)

    # -------- Cost engine config (org-level) --------
    primary_energy_sources = Column(String(255), nullable=True)  # "electricity,gas"

    electricity_price_per_kwh = Column(Numeric(10, 4), nullable=True)
    gas_price_per_kwh = Column(Numeric(10, 4), nullable=True)

    currency_code = Column(String(8), nullable=True)  # "EUR", "USD"


class User(Base):
    """
    Basic user model for authentication.
    Uses organization_id to link users to organizations.
    """
    __tablename__ = "user"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organization.id"), nullable=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)

    # NOTE:
    # You already use int flags. Keep them for backwards compatibility.
    # If you later migrate to Boolean, do it in a dedicated migration.
    is_active = Column(Integer, default=1, nullable=False)
    is_superuser = Column(Integer, default=0, nullable=False)

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    # Roles & permissions
    # Stored in DB as "owner" | "member". Default is "member".
    role = Column(String, nullable=False, server_default=text("'member'"))

    organization = relationship("Organization", back_populates="users")
    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")

    # Invites accepted by this user (usually 0 or 1)
    accepted_invites = relationship(
        "OrgInvite",
        back_populates="accepted_user",
        foreign_keys="OrgInvite.accepted_user_id",
    )

    # Invites created by this user (owner actions)
    created_invites = relationship(
        "OrgInvite",
        back_populates="created_by_user",
        foreign_keys="OrgInvite.created_by_user_id",
    )


class BillingPlan(Base):
    __tablename__ = "billing_plan"

    id = Column(Integer, primary_key=True, index=True)
    stripe_product_id = Column(String, nullable=True)
    stripe_price_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    interval = Column(String, nullable=False)  # e.g. 'month'
    amount_cents = Column(Integer, nullable=False)


class Subscription(Base):
    __tablename__ = "subscription"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False, index=True)
    stripe_customer_id = Column(String, nullable=True, index=True)
    stripe_subscription_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False)  # active, past_due, canceled, etc
    current_period_end = Column(DateTime(timezone=True))

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    user = relationship("User", back_populates="subscriptions")


class Site(Base):
    __tablename__ = "site"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organization.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String)

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    organization = relationship("Organization", back_populates="sites")
    sensors = relationship("Sensor", back_populates="site", cascade="all, delete-orphan")
    opportunities = relationship("Opportunity", back_populates="site", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="site", cascade="all, delete-orphan")


class Sensor(Base):
    __tablename__ = "sensor"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    sensor_type = Column(String, nullable=False)

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    site = relationship("Site", back_populates="sensors")
    metrics = relationship("Metric", back_populates="sensor", cascade="all, delete-orphan")


class Opportunity(Base):
    __tablename__ = "opportunity"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    site = relationship("Site", back_populates="opportunities")


class Report(Base):
    __tablename__ = "report"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    content = Column(Text)

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    site = relationship("Site", back_populates="reports")


class Metric(Base):
    __tablename__ = "metric"

    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensor.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    value = Column(Float, nullable=False)

    # ✅ Cross-DB default
    timestamp = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    sensor = relationship("Sensor", back_populates="metrics")


class TimeseriesRecord(Base):
    __tablename__ = "timeseries_record"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # NOTE: site_id remains string key (e.g. "site-23") as per your current CEI design
    site_id = Column(String, nullable=False, index=True)
    meter_id = Column(String, nullable=False)

    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    value = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)

    # NEW: org-scoped ingestion + observability
    organization_id = Column("org_id", Integer, nullable=True, index=True)
    idempotency_key = Column(String(128), nullable=True, index=True)
    source = Column(String(64), nullable=True)

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)

    __table_args__ = (
        # existing
        Index("ix_timeseries_site_timestamp", "site_id", "timestamp"),

        # NEW: fast org-scoped reads for analytics/alerts
        Index("ix_timeseries_org_site_timestamp", "org_id", "site_id", "timestamp"),

        # NEW: idempotency guarantee per org
        sa.UniqueConstraint("org_id", "idempotency_key", name="uq_ts_org_idem"),
    )


class StagingUpload(Base):
    __tablename__ = "staging_upload"

    job_id = Column(String, primary_key=True)
    payload_path = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")

    # ✅ Cross-DB default
    created_at = Column(DateTime(timezone=True), server_default=DB_NOW, nullable=False)


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

    status = Column(String(32), nullable=False, default="open", server_default="open")
    owner_user_id = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=DB_NOW)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=DB_NOW, onupdate=DB_NOW)


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

    created_by_user_id = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=DB_NOW)


class IntegrationToken(Base):
    """
    Long-lived org-scoped integration token.

    Only the hashed token is stored in DB. The raw token is returned once
    at creation time via /auth/integration-tokens.
    """
    __tablename__ = "integration_tokens"

    id = Column(Integer, primary_key=True, index=True)

    # Underlying DB column is "org_id"
    organization_id = Column("org_id", Integer, index=True, nullable=False)

    name = Column(String(255), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)

    is_active = Column(Boolean, nullable=False, default=True, server_default=sa.true())

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=DB_NOW)
    last_used_at = Column(DateTime(timezone=True), nullable=True)


class OrgInvite(Base):
    """
    Owner-minted organization invite token.

    Only a hash is stored. Raw token is returned once at creation.
    """

    __tablename__ = "org_invites"

    id = Column(Integer, primary_key=True, index=True)

    # Underlying DB column is "org_id"
    organization_id = Column("org_id", Integer, ForeignKey("organization.id"), index=True, nullable=False)

    # optional: restrict invite to a specific email
    email = Column(String(255), nullable=False)

    # role granted on acceptance
    role = Column(String(32), nullable=False, server_default=text("'member'"))

    # sha256 hex = 64 chars
    token_hash = Column(String(64), nullable=False)

    is_active = Column(Boolean, nullable=False, default=True, server_default=sa.true())

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=DB_NOW)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    revoked_at = Column(DateTime(timezone=True), nullable=True)

    accepted_at = Column(DateTime(timezone=True), nullable=True)
    accepted_user_id = Column(Integer, ForeignKey("user.id"), nullable=True)

    created_by_user_id = Column(Integer, ForeignKey("user.id"), nullable=True)

    # Relationships (match your Organization/User back_populates)
    organization = relationship("Organization", back_populates="invites")

    accepted_user = relationship(
        "User",
        foreign_keys=[accepted_user_id],
        back_populates="accepted_invites",
    )

    created_by_user = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        back_populates="created_invites",
    )

    __table_args__ = (
        sa.UniqueConstraint("org_id", "email", name="uq_org_invites_org_email"),
        Index("ix_org_invites_org_active", "org_id", "is_active"),
        Index("ix_org_invites_token_hash", "token_hash"),
    )
