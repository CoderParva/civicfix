"""PostGIS query helpers, kept out of issues/views.py."""
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D


def within_radius(queryset, *, latitude, longitude, radius_m, field="location"):
    """Filter a queryset with a geography `field` to points within radius_m metres.

    Results are annotated with `distance` (a Distance object) and ordered nearest first.
    """
    origin = Point(longitude, latitude, srid=4326)  # PostGIS order is (x=lng, y=lat)
    return (
        queryset.filter(**{f"{field}__dwithin": (origin, D(m=radius_m))})
        .annotate(distance=Distance(field, origin))
        .order_by("distance", "-created_at")
    )
