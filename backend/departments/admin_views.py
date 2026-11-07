"""Super-admin API: moderation, assignment, comment hiding and department CRUD."""
from django.db.models import Count, Prefetch
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import generics, serializers, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsSuperAdmin
from issues import services as issue_services
from issues.exceptions import Conflict
from issues.models import Issue, IssueComment
from issues.selectors import annotate_issues

from . import services
from .models import Department, IssueAssignment
from .serializers import (
    AdminIssueSerializer,
    AssignSerializer,
    DepartmentSerializer,
    OfficerCreateSerializer,
    OfficerDetailSerializer,
    ReasonSerializer,
)

TRUTHY = {"1", "true", "yes"}


def _admin_issues(user):
    queryset = annotate_issues(Issue.objects.all(), user).select_related("reporter")
    return queryset.annotate(report_count=Count("content_reports", distinct=True)).prefetch_related(
        Prefetch("assignments", queryset=IssueAssignment.objects.select_related("department", "officer__user"))
    )


def _admin_issue_data(pk, request):
    return AdminIssueSerializer(_admin_issues(request.user).get(pk=pk), context={"request": request}).data


class AdminIssueListView(generics.ListAPIView):
    """Every issue, whatever its moderation state."""

    permission_classes = [IsSuperAdmin]
    serializer_class = AdminIssueSerializer

    @extend_schema(
        parameters=[
            OpenApiParameter("moderation_status", str),
            OpenApiParameter("status", str),
            OpenApiParameter("category", int),
            OpenApiParameter("flagged", bool, description="Only issues with at least one content report."),
        ]
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        params = self.request.query_params
        queryset = _admin_issues(self.request.user)
        if "moderation_status" in params:
            if params["moderation_status"] not in Issue.ModerationStatus.values:
                raise ValidationError({"moderation_status": f"Must be one of: {', '.join(Issue.ModerationStatus.values)}."})
            queryset = queryset.filter(moderation_status=params["moderation_status"])
        if "status" in params:
            if params["status"] not in Issue.Status.values:
                raise ValidationError({"status": f"Must be one of: {', '.join(Issue.Status.values)}."})
            queryset = queryset.filter(status=params["status"])
        if "category" in params:
            try:
                queryset = queryset.filter(category_id=int(params["category"]))
            except ValueError:
                raise ValidationError({"category": "Must be an integer id."})
        if params.get("flagged", "").lower() in TRUTHY:
            queryset = queryset.filter(report_count__gt=0)
        return queryset.order_by("-created_at", "pk")


class _AdminIssueAction(APIView):
    permission_classes = [IsSuperAdmin]

    def get_issue(self, pk):
        return get_object_or_404(Issue, pk=pk)


class AdminApproveView(_AdminIssueAction):
    @extend_schema(request=None, responses=AdminIssueSerializer)
    def post(self, request, pk):
        issue = self.get_issue(pk)
        issue_services.approve_issue(issue_id=issue.pk, admin=request.user)
        return Response(_admin_issue_data(issue.pk, request))


class AdminRejectView(_AdminIssueAction):
    @extend_schema(request=ReasonSerializer, responses=AdminIssueSerializer)
    def post(self, request, pk):
        issue = self.get_issue(pk)
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue_services.reject_issue(issue_id=issue.pk, admin=request.user, reason=serializer.validated_data["reason"])
        return Response(_admin_issue_data(issue.pk, request))


class AdminAssignView(_AdminIssueAction):
    @extend_schema(request=AssignSerializer, responses={201: AdminIssueSerializer})
    def post(self, request, pk):
        issue = self.get_issue(pk)
        serializer = AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.assign_issue(
            issue_id=issue.pk,
            department=serializer.validated_data["department"],
            officer=serializer.validated_data["officer"],
            assigned_by=request.user,
        )
        return Response(_admin_issue_data(issue.pk, request), status=status.HTTP_201_CREATED)


class AdminReopenView(_AdminIssueAction):
    @extend_schema(request=ReasonSerializer, responses=AdminIssueSerializer)
    def post(self, request, pk):
        issue = self.get_issue(pk)
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue_services.reopen_issue(issue_id=issue.pk, admin=request.user, reason=serializer.validated_data["reason"])
        return Response(_admin_issue_data(issue.pk, request))


class AdminHideCommentView(APIView):
    permission_classes = [IsSuperAdmin]

    @extend_schema(
        request=None,
        responses=inline_serializer("HiddenComment", {"id": serializers.UUIDField(), "is_hidden": serializers.BooleanField()}),
    )
    def post(self, request, pk):
        comment = get_object_or_404(IssueComment, pk=pk)
        comment, _ = issue_services.hide_comment(comment_id=comment.pk, admin=request.user)
        return Response({"id": str(comment.pk), "is_hidden": comment.is_hidden})


class DepartmentViewSet(viewsets.ModelViewSet):
    """CRUD for departments. A department that is in use is deactivated, not deleted."""

    permission_classes = [IsSuperAdmin]
    serializer_class = DepartmentSerializer
    queryset = Department.objects.prefetch_related("officers__user").order_by("name", "pk")

    def perform_destroy(self, instance):
        if instance.officers.exists() or instance.assignments.exists():
            raise Conflict("This department has officers or assignment history; set is_active=false instead.")
        instance.delete()


class AdminOfficerCreateView(APIView):
    """Create an officer: a User (role=officer) and their OfficerProfile, atomically."""

    permission_classes = [IsSuperAdmin]

    @extend_schema(request=OfficerCreateSerializer, responses={201: OfficerDetailSerializer})
    def post(self, request):
        serializer = OfficerCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = serializer.save()
        return Response(OfficerDetailSerializer(profile).data, status=status.HTTP_201_CREATED)
