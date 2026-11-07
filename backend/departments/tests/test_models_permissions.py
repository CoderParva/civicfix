import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework.test import APIRequestFactory

from accounts.models import User
from common.permissions import IsAssignedDepartment
from departments.models import Department, IssueAssignment, OfficerProfile
from issues.models import Issue

pytestmark = pytest.mark.django_db

factory = APIRequestFactory()


class TestModels:
    def test_department_name_unique_per_city_case_insensitively(self, dept):
        with pytest.raises(IntegrityError), transaction.atomic():
            Department.objects.create(name="PUBLIC WORKS", city="indore")
        Department.objects.create(name="Public Works", city="Bhopal")  # same name, other city: fine

    def test_officer_profile_requires_officer_role(self, citizen, admin_user, dept):
        for user in (citizen, admin_user):
            with pytest.raises(DjangoValidationError):
                OfficerProfile.objects.create(user=user, department=dept, employee_reference=f"X-{user.role}")

    def test_one_profile_per_user_and_unique_employee_reference(self, officer_profile, make_user, dept):
        with pytest.raises(IntegrityError), transaction.atomic():
            OfficerProfile.objects.create(user=officer_profile.user, department=dept, employee_reference="OTHER")
        second = make_user("o2@example.com", User.Role.OFFICER)
        with pytest.raises(IntegrityError), transaction.atomic():
            OfficerProfile.objects.create(user=second, department=dept, employee_reference="EMP-001")

    def test_only_one_active_assignment_per_issue(self, assigned_issue, colleague, admin_user):
        with pytest.raises(IntegrityError), transaction.atomic():
            IssueAssignment.objects.create(
                issue=assigned_issue, department=colleague.department, officer=colleague, assigned_by=admin_user
            )

    def test_inactive_assignments_do_not_conflict(self, assigned_issue, colleague, admin_user):
        IssueAssignment.objects.filter(issue=assigned_issue).update(status="superseded")
        IssueAssignment.objects.create(
            issue=assigned_issue, department=colleague.department, officer=colleague, assigned_by=admin_user
        )

    def test_department_with_officers_cannot_be_deleted_at_db_level(self, officer_profile, dept):
        from django.db.models import ProtectedError

        with pytest.raises(ProtectedError):
            dept.delete()


def check(user, issue=None):
    """Run IsAssignedDepartment like DRF would. Returns (has_permission, has_object_permission or None)."""
    request = factory.get("/")
    request.user = user
    perm = IsAssignedDepartment()
    allowed = perm.has_permission(request, None)
    return allowed, (perm.has_object_permission(request, None, issue) if issue is not None else None)


class TestIsAssignedDepartment:
    def test_officer_sees_issue_assigned_to_own_department(self, officer_profile, assigned_issue):
        assert check(officer_profile.user, assigned_issue) == (True, True)

    def test_accepted_assignment_still_counts(self, officer_profile, in_progress_issue):
        assert check(officer_profile.user, in_progress_issue) == (True, True)

    def test_colleague_in_same_department_has_access(self, officer_profile, colleague, assigned_issue):
        assert check(colleague.user, assigned_issue) == (True, True)

    def test_officer_of_other_department_denied(self, officer_profile, other_officer, assigned_issue):
        assert check(other_officer.user, assigned_issue) == (True, False)

    def test_unassigned_issue_denied(self, officer_profile, issue):
        assert check(officer_profile.user, issue) == (True, False)

    @pytest.mark.parametrize("state", ["rejected", "superseded"])
    def test_ended_assignment_no_longer_grants_access(self, officer_profile, assigned_issue, state):
        IssueAssignment.objects.filter(issue=assigned_issue).update(status=state)
        assert check(officer_profile.user, assigned_issue) == (True, False)

    def test_officer_without_profile_denied_everywhere(self, make_user, assigned_issue):
        profile_less = make_user("noprofile@example.com", User.Role.OFFICER)
        assert check(profile_less, assigned_issue) == (False, False)

    def test_inactive_department_denied(self, officer_profile, assigned_issue, dept):
        Department.objects.filter(pk=dept.pk).update(is_active=False)
        officer_profile.user.refresh_from_db()
        user = User.objects.get(pk=officer_profile.user_id)  # drop the cached profile.department
        assert check(user, assigned_issue) == (False, False)

    def test_inactive_officer_denied(self, officer_profile, assigned_issue):
        User.objects.filter(pk=officer_profile.user_id).update(is_active=False)
        assert check(User.objects.get(pk=officer_profile.user_id), assigned_issue)[0] is False

    @pytest.mark.parametrize("who", ["citizen", "admin_user"])
    def test_other_roles_denied(self, who, request, assigned_issue):
        assert check(request.getfixturevalue(who), assigned_issue) == (False, False)

    def test_anonymous_denied(self, assigned_issue):
        from django.contrib.auth.models import AnonymousUser

        assert check(AnonymousUser(), assigned_issue) == (False, False)

    def test_object_with_issue_attribute_is_resolved(self, officer_profile, assigned_issue, other_officer):
        class Wrapper:
            issue = assigned_issue

        request = factory.get("/")
        request.user = other_officer.user
        assert IsAssignedDepartment().has_object_permission(request, None, Wrapper()) is False
        request.user = officer_profile.user
        assert IsAssignedDepartment().has_object_permission(request, None, Wrapper()) is True
