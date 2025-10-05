#!/usr/bin/env bash
set -euo pipefail

python -m alembic -c backend/alembic.ini upgrade head

exec gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:\