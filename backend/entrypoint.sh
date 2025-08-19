#!/bin/sh
set -e

sed -i 's/\r$//' "$0" >/dev/null 2>&1 || true

# ✅ Robust PostgreSQL wait using Python's socket (works in /bin/sh)
if [ -n "$DB_HOST" ]; then
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

if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  echo "Applying Django migrations..."
  python manage.py migrate --noinput
fi

exec "$@"


# #!/bin/sh
# set -e

# echo "Waiting for PostgreSQL at $DB_HOST:$DB_PORT..."
# while ! nc -z "$DB_HOST" "$DB_PORT"; do
#   sleep 0.2
# done
# echo "PostgreSQL is up"

# # Only run migrations if explicitly enabled (default ON for backend, OFF for worker)
# if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
#   echo "Running migrations..."
#   python manage.py migrate --noinput
#   echo "Migrations finished!"
# else
#   echo "Skipping migrations on this service."
# fi

# exec "$@"