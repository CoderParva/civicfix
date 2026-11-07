FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# GDAL/GEOS/PROJ are required by django.contrib.gis (PostGIS support)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgdal36 libgeos-c1t64 libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements/ requirements/
ARG REQUIREMENTS=dev
RUN pip install --no-cache-dir -r requirements/${REQUIREMENTS}.txt

COPY . .

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
