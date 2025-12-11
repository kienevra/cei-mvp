# backend/app/models.py
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    ForeignKey,
    TIMESTAMP,
    Text,
    JSON,
    Index,
    DateTime,
    Numeric,
    Boolean,   # <-- added
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text  # <-- text added here
from app.db.base import Base


class Organization(Base):
    __tablename__ = "organization"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    sites = relationship("Site", back_populates="organization", cascade="all, delete-orphan")
    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")

    # -------- NEW SaaS / billing fields --------
    # Plan & feature flags
    plan_key = Column(String, nullable=True)  # e.g. "free", "cei-starter"
    subscription_plan_key = Column(String, nullable=True)  # Stripe / logical plan

    enable_alerts = Column(
        Boolean,
        nullable=False,
        server_default=text("TRUE"),   # <-- CHANGED from "1"
    )
    enable_reports = Column(
        Boolean,
        nullable=False,
        server_default=text("TRUE"),   # <-- CHANGED from "1"
    )

    subscription_status = Column(
        String,
        nullable=True,
    )

    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    stripe_status = Column(String, nullable=True)

    billing_email = Column(String, nullable=True)

    # -------- NEW Cost engine config (org-level) --------
    # Comma-separated list, e.g. "electricity", "gas", "electricity,gas"
    primary_energy_sources = Column(String, nullable=True)

    # Flat/blended tariffs at org level (per kWh); we can refine later by site/meter
    electricity_price_per_kwh = Column(Float, nullable=True)
    gas_price_per_kwh = Column(Float, nullable=True)

    # Currency code like "EUR", "USD"
    currency_code = Column(String, nullable=True)


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
    is_active = Column(Integer, default=1, nullable=False)
    is_superuser = Column(Integer, default=0, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    organization = relationship("Organization", back_populates="users")
    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")


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
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user = relationship("User", back_populates="subscriptions")


class Site(Base):
    __tablename__ = "site"
    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organization.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

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
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    site = relationship("Site", back_populates="sensors")
    metrics = relationship("Metric", back_populates="sensor", cascade="all, delete-orphan")


class Opportunity(Base):
    __tablename__ = "opportunity"
    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    site = relationship("Site", back_populates="opportunities")


class Report(Base):
    __tablename__ = "report"
    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    content = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    site = relationship("Site", back_populates="reports")


class Metric(Base):
    __tablename__ = "metric"
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensor.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    value = Column(Float, nullable=False)
    timestamp = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    sensor = relationship("Sensor", back_populates="metrics")


class TimeseriesRecord(Base):
    __tablename__ = "timeseries_record"  # <-- CHANGED FROM "timeseries_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(String, nullable=False, index=True)
    meter_id = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    value = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_timeseries_site_timestamp", "site_id", "timestamp"),
    )


class StagingUpload(Base):
    __tablename__ = "staging_upload"
    job_id = Column(String, primary_key=True)
    payload_path = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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
    status = Column(
        String(32),
        nullable=False,
        default="open",
        server_default="open",
    )
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

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_used_at = Column(
        DateTime(timezone=True),
        nullable=True,
    )
