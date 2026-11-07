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
