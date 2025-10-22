from celery import Celery
import os
from app.core.config import settings

# Configure Celery with REDIS_URL from environment or settings
CELERY_BROKER_URL = settings.REDIS_URL or os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "cei_worker",
    broker=CELERY_BROKER_URL,
    backend=CELERY_BROKER_URL,
)

# If you prefer RQ, swap Celery for RQ and use RQ's Queue and Worker classes.
# Example:
# from rq import Queue, Worker
# import redis
# redis_conn = redis.from_url(CELERY_BROKER_URL)
# queue = Queue(connection=redis_conn)
# ...
