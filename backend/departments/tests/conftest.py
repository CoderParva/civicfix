import pytest

from accounts.models import User
from departments.models import Department, IssueAssignment, OfficerProfile
from issues.models import Issue

# Reuse the Phase 2 fixtures: importing a fixture function into a conftest registers it here.
from issues.tests.conftest import category, issue, issue_payload, make_issue, other_citizen, png  # noqa: E402,F401


@pytest.fixture
def dept(db):
    return Department.objects.create(name="Public Works", city="Indore", description="Roads and potholes")


@pytest.fixture
def other_dept(db):
    return Department.objects.create(name="Sanitation", city="Indore")


@pytest.fixture
def make_officer(make_user):
    counter = iter(range(1, 100))

    def _make(department, email=None):
        n = next(counter)
        user = make_user(email or f"officer{n}@example.com", User.Role.OFFICER)
        return OfficerProfile.objects.create(user=user, department=department, employee_reference=f"EMP-{department.name[:3].upper()}-{n}")

    return _make


@pytest.fixture
def officer_profile(officer, dept):
    """`officer` (root fixture) attached to `dept`."""
    return OfficerProfile.objects.create(user=officer, department=dept, employee_reference="EMP-001")


@pytest.fixture
def other_officer(make_officer, other_dept):
    return make_officer(other_dept, "other-officer@example.com")


@pytest.fixture
def colleague(make_officer, dept):
    """A second officer in the *same* department as `officer_profile`."""
    return make_officer(dept, "colleague@example.com")


@pytest.fixture
def put_in_state(admin_user):
    """Put an issue in `status`, with an assignment to `profile` in `assignment_status` (ORM, no services)."""

    def _put(issue, status, profile=None, assignment_status=IssueAssignment.Status.PENDING, moderation="approved"):
        Issue.objects.filter(pk=issue.pk).update(status=status, moderation_status=moderation)
        if profile is not None:
            IssueAssignment.objects.create(
                issue=issue,
                department=profile.department,
                officer=profile,
                assigned_by=admin_user,
                status=assignment_status,
            )
        issue.refresh_from_db()
        return issue

    return _put


@pytest.fixture
def assigned_issue(issue, officer_profile, put_in_state):
    """Approved issue, ASSIGNED to `officer_profile`, assignment still PENDING."""
    return put_in_state(issue, "assigned", officer_profile)


@pytest.fixture
def in_progress_issue(issue, officer_profile, put_in_state):
    return put_in_state(issue, "in_progress", officer_profile, IssueAssignment.Status.ACCEPTED)
