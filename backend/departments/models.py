import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower


class Department(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), Lower("city"), name="unique_department_name_per_city"),
        ]

    def __str__(self):
        return f"{self.name} ({self.city})" if self.city else self.name


class OfficerProfile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="officer_profile")
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="officers")
    employee_reference = models.CharField(max_length=50, unique=True)

    def clean(self):
        if self.user_id and self.user.role != self.user.Role.OFFICER:
            raise ValidationError({"user": "Only users with the officer role can have an officer profile."})

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user.full_name} ({self.employee_reference})"


class IssueAssignment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting officer acceptance"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected by officer"
        SUPERSEDED = "superseded", "Replaced by a newer assignment"

    # An assignment is "current" (the issue is in that department's queue) while in these states.
    ACTIVE_STATUSES = (Status.PENDING, Status.ACCEPTED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey("issues.Issue", on_delete=models.CASCADE, related_name="assignments")
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="assignments")
    officer = models.ForeignKey(OfficerProfile, on_delete=models.PROTECT, related_name="assignments")
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="assignments_made"
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.CharField(max_length=255, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-assigned_at"]
        constraints = [
            # Race-proof: an issue can sit in at most one department queue at a time.
            models.UniqueConstraint(
                fields=["issue"],
                condition=Q(status__in=["pending", "accepted"]),
                name="one_active_assignment_per_issue",
            ),
        ]


class DepartmentNote(models.Model):
    """Internal officer note. Private to staff.

    Deliberately not reachable from any citizen-facing serializer: the only serializer for it
    lives in departments/serializers.py and is used only by officer endpoints. The citizen
    IssueSerializer does not (and must not) list `department_notes`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey("issues.Issue", on_delete=models.CASCADE, related_name="department_notes")
    officer = models.ForeignKey(OfficerProfile, on_delete=models.PROTECT, related_name="notes")
    note = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
