# app/models.py
from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey, TIMESTAMP, Text, JSON, Index, DateTime, Numeric
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

class Organization(Base):
    __tablename__ = "organization"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    sites = relationship("Site", back_populates="organization", cascade="all, delete-orphan")
    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")

# Minimal User model — add this into backend/app/models.py
class User(Base):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organization.id"), nullable=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Integer, default=1, nullable=False)  # 1/0 or use Boolean if supported
    is_superuser = Column(Integer, default=0, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    organization = relationship("Organization", back_populates="users")

class Site(Base):
    __tablename__ = "site"
    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organization.id"), nullable=False, index=True)
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

# Timeseries / ingestion tables (migrated in from db/models.py)
class TimeseriesRecord(Base):
    __tablename__ = "timeseries_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(String, nullable=False, index=True)
    meter_id = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    value = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # optional index for querying by site + timestamp
    __table_args__ = (
        Index("ix_timeseries_site_timestamp", "site_id", "timestamp"),
    )

class StagingUpload(Base):
    __tablename__ = "staging_uploads"
    job_id = Column(String, primary_key=True)
    payload_path = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
