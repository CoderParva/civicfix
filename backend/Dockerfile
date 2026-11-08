FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# GDAL/GEOS/PROJ are required by django.contrib.gis (PostGIS support)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgdal36 libgeos-c1t64 libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements/ requirements/
# Production by default (what Render builds); docker-compose passes REQUIREMENTS=dev for local work.
ARG REQUIREMENTS=prod
RUN pip install --no-cache-dir -r requirements/${REQUIREMENTS}.txt

COPY . .

EXPOSE 8000
# migrate + collectstatic + gunicorn; see scripts/start.sh. docker-compose overrides this with runserver.
CMD ["sh", "scripts/start.sh"]
