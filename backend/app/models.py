from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey, TIMESTAMP, Text, JSON, Index
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

class Organization(Base):
    __tablename__ = "organization"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    sites = relationship("Site", back_populates="organization")
    users = relationship("User", back_populates="organization")

class Site(Base):
    __tablename__ = "site"
    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organization.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    location = Column(String)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    organization = relationship("Organization", back_populates="sites")
    sensors = relationship("Sensor", back_populates="site")
    opportunities = relationship("Opportunity", back_populates="site")
    reports = relationship("Report", back_populates="site")

class Sensor(Base):
    __tablename__ = "sensor"
    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    sensor_type = Column(String, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    site = relationship("Site", back_populates="sensors")
    metrics = relationship("Metric", back_populates="sensor")

class Metric(Base):
    __tablename__ = "metric"
    id = Column(Integer, primary_key=True, index=True)
    sensor_id = Column(Integer, ForeignKey("sensor.id"), nullable=False, index=True)
    ts = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    value = Column(Float, nullable=False)

    sensor = relationship("Sensor", back_populates="metrics")

    __table_args__ = (
        Index("ix_metric_sensor_ts", "sensor_id", "ts"),
    )

class Opportunity(Base):
    __tablename__ = "opportunity"
    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    est_capex_eur = Column(Float)
    est_annual_saving_kwh = Column(Float)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    site = relationship("Site", back_populates="opportunities")

class Report(Base):
    __tablename__ = "report"
    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("site.id"), nullable=False, index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    report_json = Column(JSON, nullable=False)

    site = relationship("Site", back_populates="reports")

class User(Base):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, unique=True, index=True)
    hashed_password = Column(String, nullable=False)
    org_id = Column(Integer, ForeignKey("organization.id"), nullable=False, index=True)
    role = Column(String, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    organization = relationship("Organization", back_populates="users")
