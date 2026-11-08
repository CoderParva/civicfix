from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsAssignedDepartment, IsSuperAdmin
from departments.selectors import officer_profile_of

from . import services
from .serializers import DaysQuerySerializer, DepartmentAnalyticsSerializer, PlatformAnalyticsSerializer

DAYS_PARAM = OpenApiParameter("days", int, description="Length of the over-time series, 7-365 (default 90).")


def _days(request):
    query = DaysQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    return query.validated_data["days"]


class AdminAnalyticsView(APIView):
    """Platform-wide totals, distributions, an over-time series and per-department performance."""

    permission_classes = [IsSuperAdmin]

    @extend_schema(parameters=[DAYS_PARAM], responses=PlatformAnalyticsSerializer)
    def get(self, request):
        return Response(PlatformAnalyticsSerializer(services.platform_analytics(_days(request))).data)


class OfficerAnalyticsView(APIView):
    """The same, scoped to the issues in the officer's own department queue."""

    permission_classes = [IsAssignedDepartment]

    @extend_schema(parameters=[DAYS_PARAM], responses=DepartmentAnalyticsSerializer)
    def get(self, request):
        department = officer_profile_of(request.user).department
        return Response(DepartmentAnalyticsSerializer(services.department_analytics(department, _days(request))).data)
