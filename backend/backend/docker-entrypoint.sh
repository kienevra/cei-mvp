#!/usr/bin/env bash
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set."
  exit 1
fi

if [ "$AUTO_MIGRATE" = "true" ]; then
  alembic -c backend/alembic.ini upgrade head
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
