from sqlalchemy import Column, Integer, String, DateTime, Float, Numeric, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

class TimeseriesRecord(Base):
    __tablename__ = "timeseries_records"
    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(String(128), index=True)
    meter_id = Column(String(128), index=True)
    timestamp = Column(DateTime(timezone=True), index=True)
    value = Column(Numeric(18, 6))
    unit = Column(String(32))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class StagingUpload(Base):
    __tablename__ = "staging_uploads"
    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String(64), index=True, unique=True)
    payload_path = Column(String(1024))
    status = Column(String(32), default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notes = Column(Text, nullable=True)
