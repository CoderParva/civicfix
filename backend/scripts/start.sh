#!/bin/sh
# Production start command (Render runs this via the Dockerfile CMD). Free-tier Render has no
# pre-deploy hook, so release steps run here on every boot; each one is idempotent and quick.
set -e

python manage.py ensure_postgis            # PostGIS present? (prints its version; creates it if allowed)
python manage.py migrate --noinput
python manage.py lockdown_public_schema    # row-level security on every table: Supabase's public REST API sees nothing
python manage.py collectstatic --noinput   # admin/DRF static files for whitenoise

# One worker with threads: the free instance has 0.1 vCPU / 512 MB, and a single process keeps the
# in-memory rate-limit counters consistent (several workers would each count separately).
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout 60 \
  --access-logfile -
