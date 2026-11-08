"""Response shapes for the analytics endpoints (they document the OpenAPI schema and render the data)."""
from rest_framework import serializers


class StatusCountSerializer(serializers.Serializer):
    status = serializers.CharField()
    count = serializers.IntegerField()


class PriorityCountSerializer(serializers.Serializer):
    priority = serializers.CharField()
    count = serializers.IntegerField()


class CategoryCountSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    count = serializers.IntegerField()


class DayPointSerializer(serializers.Serializer):
    date = serializers.DateField()
    reported = serializers.IntegerField()
    resolved = serializers.IntegerField()


class DepartmentPerformanceSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    city = serializers.CharField(allow_blank=True)
    is_active = serializers.BooleanField()
    in_queue = serializers.IntegerField()
    in_progress = serializers.IntegerField()
    resolved = serializers.IntegerField()
    rejected_assignments = serializers.IntegerField()
    avg_resolution_hours = serializers.FloatField(allow_null=True)


class PlatformTotalsSerializer(serializers.Serializer):
    issues = serializers.IntegerField()
    awaiting_moderation = serializers.IntegerField()
    open = serializers.IntegerField()
    resolved = serializers.IntegerField()
    rejected = serializers.IntegerField()
    flagged = serializers.IntegerField()
    avg_resolution_hours = serializers.FloatField(allow_null=True)


class DepartmentTotalsSerializer(serializers.Serializer):
    in_queue = serializers.IntegerField()
    awaiting_acceptance = serializers.IntegerField()
    in_progress = serializers.IntegerField()
    resolved = serializers.IntegerField()
    rejected_assignments = serializers.IntegerField()
    avg_resolution_hours = serializers.FloatField(allow_null=True)


class _Distributions(serializers.Serializer):
    range_days = serializers.IntegerField()
    by_status = StatusCountSerializer(many=True)
    by_priority = PriorityCountSerializer(many=True)
    by_category = CategoryCountSerializer(many=True)
    over_time = DayPointSerializer(many=True)


class PlatformAnalyticsSerializer(_Distributions):
    totals = PlatformTotalsSerializer()
    departments = DepartmentPerformanceSerializer(many=True)


class _DepartmentRefSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    city = serializers.CharField(allow_blank=True)


class DepartmentAnalyticsSerializer(_Distributions):
    department = _DepartmentRefSerializer()
    totals = DepartmentTotalsSerializer()


class DaysQuerySerializer(serializers.Serializer):
    days = serializers.IntegerField(min_value=7, max_value=365, required=False, default=90)
