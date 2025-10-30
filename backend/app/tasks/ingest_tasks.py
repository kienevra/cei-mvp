from app.worker import celery_app
from app.services.ingest import process_job
import logging
from sqlalchemy.exc import OperationalError

@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def process_csv_job(self, job_id):
    """
    Celery task to process CSV job. Retries on transient DB/network errors.
    """
    try:
        # You must pass a DB session here in real usage
        db = None  # Replace with actual session
        process_job(job_id, db)
    except OperationalError as exc:
        logging.warning(f"Transient DB error for job {job_id}: {exc}. Retrying...")
        raise self.retry(exc=exc)
    except Exception as exc:
        logging.error(f"Failed to process CSV job {job_id}: {exc}")
        raise

@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def process_timeseries_job(self, job_id):
    """
    Celery task to process timeseries job. Retries on transient DB/network errors.
    """
    try:
        db = None  # Replace with actual session
        process_job(job_id, db)
    except OperationalError as exc:
        logging.warning(f"Transient DB error for job {job_id}: {exc}. Retrying...")
        raise self.retry(exc=exc)
    except Exception as exc:
        logging.error(f"Failed to process timeseries job {job_id}: {exc}")
        raise

# If you prefer RQ, swap @celery_app.task for RQ's @job decorator and enqueue with queue.enqueue.
