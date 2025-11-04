#!/bin/sh
set -e

# --- graceful shutdown for PID 1 ---
trap 'echo "Shutting down..."; exit 0' TERM INT

# --- wait for Postgres if configured ---
if [ -n "${DB_HOST:-}" ]; then
  echo "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT:-5432}..."
  python - <<'PY'
import os, socket, time, sys
host = os.environ.get("DB_HOST")
port = int(os.environ.get("DB_PORT", "5432"))
deadline = time.time() + 60
while time.time() < deadline:
    try:
        with socket.create_connection((host, port), timeout=2):
            sys.exit(0)
    except OSError:
        time.sleep(0.5)
print("ERROR: DB not reachable within 60s", file=sys.stderr)
sys.exit(1)
PY
  echo "PostgreSQL is up"
fi

# --- optional migrations (prod-safe) ---
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "Applying Django migrations..."
  python manage.py migrate --noinput
  echo "Migrations applied."
fi

# --- optional collectstatic ---
if [ "${COLLECTSTATIC:-0}" = "1" ] && [ -f manage.py ]; then
  echo "Collecting static files..."
  python manage.py collectstatic --noinput
fi

# --- start the app (delegated to CMD/compose) ---
echo "Starting: $*"
exec "$@"
