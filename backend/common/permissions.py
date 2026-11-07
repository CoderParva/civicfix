"""Role-based DRF permission classes. Every app imports role checks from here.

These are the real security boundary; frontend route guards are only UX.
"""
from rest_framework.permissions import BasePermission

from accounts.models import User


class _HasRole(BasePermission):
    role = None

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.role == self.role)


class IsCitizen(_HasRole):
    role = User.Role.CITIZEN


class IsDepartmentOfficer(_HasRole):
    role = User.Role.OFFICER


class IsSuperAdmin(_HasRole):
    role = User.Role.ADMIN


class IsAssignedDepartment(BasePermission):
    """Department isolation for officers.

    View level: an active officer whose department is active. Object level (an Issue, or
    anything with `.issue`): the issue must currently be in that officer's department queue.
    Every officer endpoint uses this, so "officers can't see other departments' issues" is
    tested here once.
    """

    def has_permission(self, request, view):
        from departments.selectors import officer_profile_of

        user = request.user
        if not (user and user.is_authenticated and user.is_active and user.role == User.Role.OFFICER):
            return False
        profile = officer_profile_of(user)
        return bool(profile and profile.department.is_active)

    def has_object_permission(self, request, view, obj):
        from departments.selectors import is_assigned_to_department, officer_profile_of

        profile = officer_profile_of(request.user)
        if profile is None or not profile.department.is_active:
            return False
        issue = getattr(obj, "issue", obj)
        return is_assigned_to_department(issue.pk, profile.department_id)
