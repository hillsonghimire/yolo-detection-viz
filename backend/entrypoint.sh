#!/bin/sh
set -e

echo "Waiting for PostgreSQL at $DB_HOST:$DB_PORT..."
while ! nc -z "$DB_HOST" "$DB_PORT"; do
  sleep 0.2
done
echo "PostgreSQL is up"

# Only run migrations if explicitly enabled (default ON for backend, OFF for worker)
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "Running migrations..."
  python manage.py migrate --noinput
  echo "Migrations finished!"
else
  echo "Skipping migrations on this service."
fi

exec "$@"