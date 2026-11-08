from django.urls import include, path
from rest_framework.routers import SimpleRouter

from . import admin_views, officer_views

router = SimpleRouter()
router.register("admin/departments", admin_views.DepartmentViewSet, basename="admin-department")

urlpatterns = [
    # --- officer ---
    path("officer/issues/", officer_views.OfficerIssueListView.as_view(), name="officer-issue-list"),
    path("officer/issues/<uuid:pk>/", officer_views.OfficerIssueDetailView.as_view(), name="officer-issue-detail"),
    path("officer/issues/<uuid:pk>/accept/", officer_views.OfficerAcceptView.as_view(), name="officer-accept"),
    path("officer/issues/<uuid:pk>/reject/", officer_views.OfficerRejectView.as_view(), name="officer-reject"),
    path("officer/issues/<uuid:pk>/resolve/", officer_views.OfficerResolveView.as_view(), name="officer-resolve"),
    path(
        "officer/issues/<uuid:pk>/images/",
        officer_views.OfficerResolutionImageView.as_view(),
        name="officer-resolution-image",
    ),
    path("officer/issues/<uuid:pk>/notes/", officer_views.OfficerNoteListCreateView.as_view(), name="officer-notes"),
    # --- admin ---
    path("admin/officers/", admin_views.AdminOfficerCreateView.as_view(), name="admin-officer-create"),
    path("admin/issues/", admin_views.AdminIssueListView.as_view(), name="admin-issue-list"),
    # NOT IMPLEMENTED (deliberately): GET admin/issues/duplicates/ -- the duplicate-review queue.
    # It needs a real duplicate_score per issue pair, which only exists once the AI engine
    # (Phase 7, ai_engine.AIAnalysis.duplicate_score) is built. Adding the route now would mean
    # inventing a score, which the plan forbids ("no hardcoded numbers"). Add it in Phase 7.
    path("admin/issues/<uuid:pk>/", admin_views.AdminIssueDetailView.as_view(), name="admin-issue-detail"),
    path("admin/issues/<uuid:pk>/approve/", admin_views.AdminApproveView.as_view(), name="admin-approve"),
    path("admin/issues/<uuid:pk>/reject/", admin_views.AdminRejectView.as_view(), name="admin-reject"),
    path("admin/issues/<uuid:pk>/assign/", admin_views.AdminAssignView.as_view(), name="admin-assign"),
    path("admin/issues/<uuid:pk>/reopen/", admin_views.AdminReopenView.as_view(), name="admin-reopen"),
    path("admin/comments/<uuid:pk>/hide/", admin_views.AdminHideCommentView.as_view(), name="admin-hide-comment"),
    path("", include(router.urls)),
]
