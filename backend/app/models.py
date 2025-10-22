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
