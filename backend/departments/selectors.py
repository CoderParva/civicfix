"""Department-scoping queries. The single source of truth for "which issues does this department see"."""
from issues.models import Issue

from .models import IssueAssignment

ACTIVE = IssueAssignment.ACTIVE_STATUSES


def officer_profile_of(user):
    """The user's OfficerProfile (with department), or None."""
    if user is None or not user.is_authenticated:
        return None
    return getattr(user, "officer_profile", None)  # RelatedObjectDoesNotExist subclasses AttributeError


def issues_assigned_to(department):
    """Issues currently in this department's queue (a pending or accepted assignment)."""
    return Issue.objects.filter(assignments__department=department, assignments__status__in=ACTIVE)


def is_assigned_to_department(issue_id, department_id):
    return IssueAssignment.objects.filter(issue_id=issue_id, department_id=department_id, status__in=ACTIVE).exists()
