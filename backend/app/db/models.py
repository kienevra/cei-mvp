from sqlalchemy import Column, Integer, String, DateTime, Float, Numeric
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

class TimeseriesRecord(Base):
    __tablename__ = "timeseries_records"
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(String, nullable=False)
    meter_id = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    value = Column(Numeric, nullable=False)
    unit = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

class StagingUpload(Base):
    __tablename__ = "staging_uploads"
    job_id = Column(String, primary_key=True)
    payload_path = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
