from django.contrib import admin

from .models import Department, DepartmentNote, IssueAssignment, OfficerProfile


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("name", "city", "is_active")
    list_filter = ("is_active", "city")
    search_fields = ("name",)


@admin.register(OfficerProfile)
class OfficerProfileAdmin(admin.ModelAdmin):
    """How officers are created for now: make a User with role=officer, then attach a profile here."""

    list_display = ("user", "department", "employee_reference")
    list_filter = ("department",)
    search_fields = ("user__email", "user__full_name", "employee_reference")


@admin.register(IssueAssignment)
class IssueAssignmentAdmin(admin.ModelAdmin):
    list_display = ("issue", "department", "officer", "status", "assigned_at")
    list_filter = ("status", "department")


admin.site.register(DepartmentNote)
