"""Read-side queries. Visibility rules live here, in one place."""
from django.db.models import Count, Exists, OuterRef, Q, Value, BooleanField

from .models import Issue, IssueFollow, IssueVote


def public_issues():
    """Issues anyone may see: approved by moderation and marked public."""
    return Issue.objects.filter(moderation_status=Issue.ModerationStatus.APPROVED, is_public=True)


def visible_issues(user):
    """Public issues, plus the user's own issues in any moderation state."""
    condition = Q(moderation_status=Issue.ModerationStatus.APPROVED, is_public=True)
    if user is not None and user.is_authenticated:
        condition |= Q(reporter=user)
    return Issue.objects.filter(condition)


def annotate_issues(queryset, user):
    """Attach counts and per-viewer flags the IssueSerializer expects."""
    queryset = (
        queryset.select_related("category")
        .prefetch_related("images")
        .annotate(
            vote_count=Count("votes", distinct=True),
            comment_count=Count("comments", filter=Q(comments__is_hidden=False), distinct=True),
        )
    )
    if user is not None and user.is_authenticated:
        return queryset.annotate(
            has_voted=Exists(IssueVote.objects.filter(issue=OuterRef("pk"), user=user)),
            is_following=Exists(IssueFollow.objects.filter(issue=OuterRef("pk"), user=user)),
        )
    return queryset.annotate(
        has_voted=Value(False, output_field=BooleanField()),
        is_following=Value(False, output_field=BooleanField()),
    )
