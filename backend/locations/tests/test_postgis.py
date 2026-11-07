import pytest
from django.db import connection

pytestmark = pytest.mark.django_db


def test_postgis_extension_is_available():
    """Phase 1 risk check: confirms PostGIS really is enabled on the database in use."""
    with connection.cursor() as cur:
        cur.execute("SELECT PostGIS_Version()")
        assert cur.fetchone()[0]


def test_geography_distance_query_works():
    with connection.cursor() as cur:
        # Indore -> Bhopal is roughly 170-190 km
        cur.execute(
            "SELECT ST_Distance("
            "ST_SetSRID(ST_MakePoint(75.8577, 22.7196), 4326)::geography,"
            "ST_SetSRID(ST_MakePoint(77.4126, 23.2599), 4326)::geography)"
        )
        metres = cur.fetchone()[0]
    assert 150_000 < metres < 200_000
