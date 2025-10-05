#!/usr/bin/env bash
set -euo pipefail

# CEI optimized startup script: run alembic only if needed, then start app.
ALEMBIC_CFG="backend/alembic.ini"

echo "=== CEI backend start: checking migrations ==="

# Helper: run alembic subcommand and capture only useful stdout (suppress noise).
_alembic_out() {
  # $1 = subcommand (e.g. "current" / "heads")
  # Use --raiseerr so alembic returns non-zero on bad DB connection
  alembic -c "${ALEMBIC_CFG}" "$1" 2>/dev/null || true
}

# Get DB current revision string (empty if none)
db_current_raw=$(_alembic_out "current")
db_current=$(echo "$db_current_raw" | sed -n 's/.*: //p' | tr -d '\r\n' || true)

# Get code head(s) revision string(s)
heads_raw=$(_alembic_out "heads")
# Normalize: first token-like thing that looks like a hex revision (alembic outputs vary)
code_heads=$(echo "$heads_raw" | tr '\n' ' ' | sed -E 's/.*([0-9a-f]{6,40}).*/\1/ I' || true)

echo "DB current revision:  ${db_current:-<none>}"
echo "Code head revision:   ${code_heads:-<unknown>}"

# Decide if upgrade is needed
do_upgrade=false

if [ -z "${db_current}" ] || [ "${db_current}" = "<none>" ]; then
  # No revision recorded in DB -> probably fresh DB, run migrations
  echo "No current DB revision detected — running migrations."
  do_upgrade=true
elif [ -z "${code_heads}" ]; then
  # Can't determine heads from repository (unexpected) -> skip but warn
  echo "Warning: could not determine code head revision. Skipping automatic migrations."
  do_upgrade=false
elif [ "${db_current}" != "${code_heads}" ]; then
  echo "DB revision and code head differ. Running alembic upgrade head."
  do_upgrade=true
else
  echo "DB is up-to-date with code (no migrations needed)."
  do_upgrade=false
fi

if [ "${do_upgrade}" = true ] ; then
  echo "=== Running alembic upgrade head ==="
  # If alembic fails here, the process will exit (set -e)
  alembic -c "${ALEMBIC_CFG}" upgrade head
  echo "=== Alembic migrations complete ==="
fi

echo "=== Starting Gunicorn (Uvicorn worker) ==="
exec gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:${PORT:-10000}
