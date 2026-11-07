from django.urls import path

from . import views

urlpatterns = [
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("issues/", views.IssueListCreateView.as_view(), name="issue-list"),
    path("issues/nearby/", views.NearbyIssuesView.as_view(), name="issue-nearby"),
    path("issues/<uuid:pk>/", views.IssueDetailView.as_view(), name="issue-detail"),
    path("issues/<uuid:pk>/images/", views.IssueImageCreateView.as_view(), name="issue-images"),
    path("issues/<uuid:pk>/comments/", views.IssueCommentListCreateView.as_view(), name="issue-comments"),
    path("issues/<uuid:pk>/vote/", views.IssueVoteView.as_view(), name="issue-vote"),
    path("issues/<uuid:pk>/follow/", views.IssueFollowView.as_view(), name="issue-follow"),
    path("issues/<uuid:pk>/report/", views.IssueReportView.as_view(), name="issue-report"),
    path("comments/<uuid:pk>/report/", views.CommentReportView.as_view(), name="comment-report"),
]
