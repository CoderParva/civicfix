"""Officer API. Every view uses IsAssignedDepartment; actions additionally require being the assigned officer."""
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsAssignedDepartment
from issues.models import Issue
from issues.selectors import annotate_issues
from issues.serializers import IssueImageSerializer
from issues.throttles import ImageUploadThrottle

from . import services
from .models import IssueAssignment
from .selectors import issues_assigned_to, officer_profile_of
from .serializers import (
    DepartmentNoteSerializer,
    NoteCreateSerializer,
    OfficerIssueSerializer,
    ReasonSerializer,
    ResolutionImageUploadSerializer,
    ResolveSerializer,
)

ASSIGNMENT_PREFETCH = Prefetch(
    "assignments", queryset=IssueAssignment.objects.select_related("department", "officer__user")
)


def _officer_issue_data(pk, request):
    issue = annotate_issues(Issue.objects.filter(pk=pk), request.user).prefetch_related(ASSIGNMENT_PREFETCH).get()
    return OfficerIssueSerializer(issue, context={"request": request}).data


class OfficerIssueListView(generics.ListAPIView):
    """Issues currently in the officer's own department queue."""

    permission_classes = [IsAssignedDepartment]
    serializer_class = OfficerIssueSerializer

    @extend_schema(parameters=[OpenApiParameter("status", str, description="Filter by issue status.")])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        queryset = issues_assigned_to(officer_profile_of(self.request.user).department)
        value = self.request.query_params.get("status")
        if value:
            if value not in Issue.Status.values:
                raise ValidationError({"status": f"Must be one of: {', '.join(Issue.Status.values)}."})
            queryset = queryset.filter(status=value)
        queryset = annotate_issues(queryset, self.request.user).prefetch_related(ASSIGNMENT_PREFETCH)
        return queryset.order_by("-created_at", "pk")


class _OfficerIssueView(APIView):
    permission_classes = [IsAssignedDepartment]

    def get_issue(self, pk):
        issue = get_object_or_404(Issue, pk=pk)
        self.check_object_permissions(self.request, issue)  # 403 unless it is in this officer's department
        return issue


class OfficerAcceptView(_OfficerIssueView):
    @extend_schema(request=None, responses=OfficerIssueSerializer)
    def post(self, request, pk):
        issue = self.get_issue(pk)
        services.accept_assignment(issue_id=issue.pk, actor=request.user)
        return Response(_officer_issue_data(issue.pk, request))


class OfficerRejectView(_OfficerIssueView):
    @extend_schema(request=ReasonSerializer, responses=OfficerIssueSerializer)
    def post(self, request, pk):
        issue = self.get_issue(pk)
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reject_assignment(issue_id=issue.pk, actor=request.user, reason=serializer.validated_data["reason"])
        return Response(_officer_issue_data(issue.pk, request))


class OfficerResolveView(_OfficerIssueView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_classes = [ImageUploadThrottle]

    @extend_schema(request={"multipart/form-data": ResolveSerializer}, responses=OfficerIssueSerializer)
    def post(self, request, pk):
        issue = self.get_issue(pk)
        serializer = ResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.resolve_issue(
            issue_id=issue.pk,
            actor=request.user,
            upload=serializer.validated_data.get("image"),
            remarks=serializer.validated_data["remarks"],
        )
        return Response(_officer_issue_data(issue.pk, request))


class OfficerResolutionImageView(_OfficerIssueView):
    """Upload a resolution photo ahead of /resolve/ (so resolve can be a plain JSON call)."""

    parser_classes = [MultiPartParser]
    throttle_classes = [ImageUploadThrottle]

    @extend_schema(request={"multipart/form-data": ResolutionImageUploadSerializer}, responses={201: IssueImageSerializer})
    def post(self, request, pk):
        issue = self.get_issue(pk)
        serializer = ResolutionImageUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        image = services.add_resolution_image(
            issue_id=issue.pk, actor=request.user, upload=serializer.validated_data["image"]
        )
        return Response(IssueImageSerializer(image, context={"request": request}).data, status=status.HTTP_201_CREATED)


class OfficerNoteListCreateView(generics.ListCreateAPIView):
    """Private department notes on an issue in the officer's department."""

    permission_classes = [IsAssignedDepartment]

    def get_serializer_class(self):
        return NoteCreateSerializer if self.request.method == "POST" else DepartmentNoteSerializer

    def _issue(self):
        issue = get_object_or_404(Issue, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, issue)
        return issue

    def get_queryset(self):
        return self._issue().department_notes.select_related("officer__user", "officer__department")

    @extend_schema(request=NoteCreateSerializer, responses={201: DepartmentNoteSerializer})
    def post(self, request, pk):
        issue = self._issue()
        serializer = NoteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = services.add_note(issue_id=issue.pk, actor=request.user, note=serializer.validated_data["note"])
        return Response(DepartmentNoteSerializer(note).data, status=status.HTTP_201_CREATED)
