from io import BytesIO

from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsCitizen, IsSuperAdmin
from issues.images import sanitize_image
from issues.models import Issue
from issues.serializers import ImageUploadSerializer

from . import services
from .models import AIAnalysis
from .serializers import AIAnalysisSerializer, DuplicateCheckSerializer, PriorityRequestSerializer, not_analyzed
from .throttles import AIClassifyThrottle, AIDuplicatesThrottle, AIPriorityThrottle


class ClassifyView(APIView):
    """Suggest a category from a photo. 200 for any valid image; `status` says whether there is a suggestion."""

    parser_classes = [MultiPartParser]
    permission_classes = [IsCitizen]
    throttle_classes = [AIClassifyThrottle]

    @extend_schema(request={"multipart/form-data": ImageUploadSerializer}, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = ImageUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Same validation and re-encoding as a real upload: this accepts exactly what the report form would.
        cleaned = sanitize_image(serializer.validated_data["image"])
        result = services.classify_image(services.load_pil_image(BytesIO(cleaned.read())))
        return Response(result)


class DuplicatesView(APIView):
    """Reports near a location that look like the same problem. Citizens are only shown public reports."""

    permission_classes = [IsCitizen | IsSuperAdmin]
    throttle_classes = [AIDuplicatesThrottle]

    @extend_schema(request=DuplicateCheckSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = DuplicateCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "issue_id" in data:
            if request.user.role != "admin":
                return Response({"detail": "Only admins can check an existing issue."}, status=status.HTTP_403_FORBIDDEN)
            issue = get_object_or_404(Issue.objects.select_related("category"), pk=data["issue_id"])
            result = services.find_duplicates(
                latitude=issue.location.y,
                longitude=issue.location.x,
                title=issue.title,
                description=issue.description,
                category_id=issue.category_id,
                exclude_issue_id=issue.pk,
                include_hidden=True,
            )
        else:
            category = data.get("category")
            result = services.find_duplicates(
                latitude=data["latitude"],
                longitude=data["longitude"],
                title=data["title"],
                description=data["description"],
                category_id=category.pk if category else None,
                include_hidden=False,
            )
        return Response(result)


class PriorityView(APIView):
    """Rule-based priority recommendation. Pure computation: works with or without any model."""

    permission_classes = [IsCitizen | IsSuperAdmin]
    throttle_classes = [AIPriorityThrottle]

    @extend_schema(request=PriorityRequestSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = PriorityRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "issue_id" in data:
            if request.user.role != "admin":
                return Response({"detail": "Only admins can score an existing issue."}, status=status.HTTP_403_FORBIDDEN)
            issue = get_object_or_404(Issue.objects.select_related("category"), pk=data["issue_id"])
            still_open = issue.status not in (Issue.Status.RESOLVED, Issue.Status.REJECTED)
            age_days = (timezone.now() - issue.created_at).total_seconds() / 86400 if still_open else 0.0
            result = services.recommend_priority(
                category_name=issue.category.name,
                title=issue.title,
                description=issue.description,
                votes=issue.votes.count(),
                age_days=age_days,
            )
        else:
            result = services.recommend_priority(
                category_name=data["category"].name,
                title=data["title"],
                description=data["description"],
                votes=data["votes"],
            )
        return Response(result)


class AnalysisView(APIView):
    """What the AI helpers recorded for one issue (admin review). 200 with status "not_analyzed" when there is none."""

    permission_classes = [IsSuperAdmin]

    @extend_schema(responses=AIAnalysisSerializer)
    def get(self, request, issue_id):
        issue = get_object_or_404(Issue.objects.select_related("category"), pk=issue_id)
        analysis = AIAnalysis.objects.filter(issue=issue).first()
        if analysis is None:
            return Response(not_analyzed(issue))
        return Response(AIAnalysisSerializer(analysis).data)
