from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema, inline_serializer
from rest_framework import generics, serializers, status
from rest_framework.exceptions import NotAuthenticated, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsCitizen
from locations.queries import within_radius

from . import services
from .models import Issue, IssueCategory, IssueComment
from .selectors import annotate_issues, public_issues, visible_issues
from .serializers import (
    CategorySerializer,
    CommentCreateSerializer,
    CommentSerializer,
    ImageUploadSerializer,
    IssueCreateSerializer,
    IssueImageSerializer,
    IssueSerializer,
    IssueUpdateSerializer,
    NearbyIssueSerializer,
    NearbyQuerySerializer,
    ReportSerializer,
)
from .throttles import CommentCreateThrottle, ContentReportThrottle, ImageUploadThrottle, IssueCreateThrottle

TRUTHY = {"1", "true", "yes"}


def _annotated_issue(pk, user):
    return annotate_issues(Issue.objects.filter(pk=pk), user).get()


def _public_issue_or_404(pk):
    return get_object_or_404(public_issues(), pk=pk)


class CategoryListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    pagination_class = None
    serializer_class = CategorySerializer
    queryset = IssueCategory.objects.filter(is_active=True)


class IssueListCreateView(generics.ListCreateAPIView):
    """GET: public (approved) issues, or the caller's own with ?mine=true. POST: citizens report an issue."""

    def get_permissions(self):
        return [IsCitizen()] if self.request.method == "POST" else [AllowAny()]

    def get_throttles(self):
        return [IssueCreateThrottle()] if self.request.method == "POST" else []

    def get_serializer_class(self):
        return IssueCreateSerializer if self.request.method == "POST" else IssueSerializer

    @extend_schema(
        parameters=[
            OpenApiParameter("mine", bool, description="Only my own issues, in any moderation state (auth required)."),
            OpenApiParameter("category", int, description="Filter by category id."),
            OpenApiParameter("status", str, description="Filter by issue status."),
        ],
        responses=IssueSerializer(many=True),
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        params = self.request.query_params
        if params.get("mine", "").lower() in TRUTHY:
            if not user.is_authenticated:
                raise NotAuthenticated()
            queryset = Issue.objects.filter(reporter=user)
        else:
            queryset = public_issues()

        if "category" in params:
            try:
                queryset = queryset.filter(category_id=int(params["category"]))
            except ValueError:
                raise ValidationError({"category": "Must be an integer id."})
        if "status" in params:
            if params["status"] not in Issue.Status.values:
                raise ValidationError({"status": f"Must be one of: {', '.join(Issue.Status.values)}."})
            queryset = queryset.filter(status=params["status"])
        # Explicit order: aggregate annotations drop Meta.ordering, and pagination needs a stable one.
        return annotate_issues(queryset, user).order_by("-created_at", "pk")

    @extend_schema(request=IssueCreateSerializer, responses={201: IssueSerializer})
    def post(self, request, *args, **kwargs):
        serializer = IssueCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue = services.create_issue(reporter=request.user, **serializer.validated_data)
        data = IssueSerializer(_annotated_issue(issue.pk, request.user), context={"request": request}).data
        return Response(data, status=status.HTTP_201_CREATED)


class IssueDetailView(generics.RetrieveUpdateAPIView):
    """GET: public issue, or your own in any state (others get 404). PATCH: title/description, owner only, REPORTED only."""

    http_method_names = ["get", "patch", "head", "options"]
    serializer_class = IssueSerializer

    def get_permissions(self):
        return [IsCitizen()] if self.request.method == "PATCH" else [AllowAny()]

    def get_object(self):
        user = self.request.user
        return get_object_or_404(annotate_issues(visible_issues(user), user), pk=self.kwargs["pk"])

    @extend_schema(request=IssueUpdateSerializer, responses=IssueSerializer)
    def patch(self, request, *args, **kwargs):
        issue = self.get_object()  # 404 if the caller can't even see it (no existence leak)
        serializer = IssueUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.update_issue_text(issue_id=issue.pk, actor=request.user, **serializer.validated_data)  # 403/409 here
        return Response(IssueSerializer(_annotated_issue(issue.pk, request.user), context={"request": request}).data)


class NearbyIssuesView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = NearbyIssueSerializer

    @extend_schema(
        parameters=[
            OpenApiParameter("lat", float, required=True),
            OpenApiParameter("lng", float, required=True),
            OpenApiParameter("radius", float, description="Metres, 1-20000 (default 1000)."),
        ]
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        query = NearbyQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        center = query.validated_data
        queryset = within_radius(
            public_issues(), latitude=center["lat"], longitude=center["lng"], radius_m=center["radius"]
        )
        return annotate_issues(queryset, self.request.user)


class IssueImageCreateView(APIView):
    parser_classes = [MultiPartParser]
    permission_classes = [IsCitizen]
    throttle_classes = [ImageUploadThrottle]

    @extend_schema(request={"multipart/form-data": ImageUploadSerializer}, responses={201: IssueImageSerializer})
    def post(self, request, pk):
        issue = get_object_or_404(visible_issues(request.user), pk=pk)
        serializer = ImageUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        image = services.add_image(issue_id=issue.pk, actor=request.user, upload=serializer.validated_data["image"])
        return Response(IssueImageSerializer(image, context={"request": request}).data, status=status.HTTP_201_CREATED)


class IssueCommentListCreateView(generics.ListCreateAPIView):
    def get_permissions(self):
        return [IsCitizen()] if self.request.method == "POST" else [AllowAny()]

    def get_throttles(self):
        return [CommentCreateThrottle()] if self.request.method == "POST" else []

    def get_serializer_class(self):
        return CommentCreateSerializer if self.request.method == "POST" else CommentSerializer

    def get_queryset(self):
        issue = _public_issue_or_404(self.kwargs["pk"])
        return issue.comments.filter(is_hidden=False).select_related("user")

    @extend_schema(request=CommentCreateSerializer, responses={201: CommentSerializer})
    def post(self, request, pk):
        issue = _public_issue_or_404(pk)
        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = services.add_comment(issue=issue, user=request.user, content=serializer.validated_data["content"])
        return Response(CommentSerializer(comment, context={"request": request}).data, status=status.HTTP_201_CREATED)


class IssueVoteView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(
        request=None,
        responses=inline_serializer("VoteState", {"voted": serializers.BooleanField(), "vote_count": serializers.IntegerField()}),
    )
    def post(self, request, pk):
        voted, count = services.toggle_vote(issue=_public_issue_or_404(pk), user=request.user)
        return Response({"voted": voted, "vote_count": count})


class IssueFollowView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(
        request=None,
        responses=inline_serializer(
            "FollowState", {"following": serializers.BooleanField(), "follower_count": serializers.IntegerField()}
        ),
    )
    def post(self, request, pk):
        following, count = services.toggle_follow(issue=_public_issue_or_404(pk), user=request.user)
        return Response({"following": following, "follower_count": count})


REPORT_RESPONSES = {
    201: OpenApiResponse(description="Report recorded."),
    200: OpenApiResponse(description="You already reported this; nothing changed."),
}


def _report_response(created):
    if created:
        return Response({"detail": "Report received."}, status=status.HTTP_201_CREATED)
    return Response({"detail": "You have already reported this."}, status=status.HTTP_200_OK)


class IssueReportView(APIView):
    permission_classes = [IsCitizen]
    throttle_classes = [ContentReportThrottle]

    @extend_schema(request=ReportSerializer, responses=REPORT_RESPONSES)
    def post(self, request, pk):
        issue = _public_issue_or_404(pk)
        serializer = ReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, created = services.report_issue(issue=issue, reporter=request.user, **serializer.validated_data)
        return _report_response(created)


class CommentReportView(APIView):
    permission_classes = [IsCitizen]
    throttle_classes = [ContentReportThrottle]

    @extend_schema(request=ReportSerializer, responses=REPORT_RESPONSES)
    def post(self, request, pk):
        comment = get_object_or_404(
            IssueComment.objects.filter(
                is_hidden=False,
                issue__moderation_status=Issue.ModerationStatus.APPROVED,
                issue__is_public=True,
            ),
            pk=pk,
        )
        serializer = ReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        _, created = services.report_comment(comment=comment, reporter=request.user, **serializer.validated_data)
        return _report_response(created)
