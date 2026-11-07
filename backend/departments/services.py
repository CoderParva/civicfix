"""Assignment workflow. Status changes always go through issues.services.change_status."""
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.models import User
from issues import services as issue_services
from issues.exceptions import Conflict
from issues.models import Issue, IssueImage

from .models import DepartmentNote, IssueAssignment, OfficerProfile
from .selectors import ACTIVE, is_assigned_to_department, officer_profile_of


def release_assignments(issue_id):
    """Take the issue out of any department queue (used when it is rejected or reassigned)."""
    IssueAssignment.objects.filter(issue_id=issue_id, status__in=ACTIVE).update(
        status=IssueAssignment.Status.SUPERSEDED
    )


@transaction.atomic
def assign_issue(*, issue_id, department, officer, assigned_by):
    """UNDER_REVIEW -> ASSIGNED, creating the assignment. A REOPENED issue is re-reviewed first."""
    if not department.is_active:
        raise ValidationError({"department": ["This department is not active."]})
    if officer.department_id != department.id:
        raise ValidationError({"officer": ["This officer does not belong to the selected department."]})
    if not officer.user.is_active:
        raise ValidationError({"officer": ["This officer's account is inactive."]})

    issue = Issue.objects.select_for_update().get(pk=issue_id)
    if issue.status == Issue.Status.REOPENED:
        # REOPENED -> UNDER_REVIEW -> ASSIGNED in one admin action; both steps get a history row.
        issue_services.change_status(
            issue_id=issue_id,
            new_status=Issue.Status.UNDER_REVIEW,
            changed_by=assigned_by,
            reason="Re-reviewed for reassignment",
        )
    issue_services.change_status(
        issue_id=issue_id,
        new_status=Issue.Status.ASSIGNED,
        changed_by=assigned_by,
        reason=f"Assigned to {department.name}",
    )
    release_assignments(issue_id)  # any earlier cycle's assignment is now history
    return IssueAssignment.objects.create(
        issue_id=issue_id, department=department, officer=officer, assigned_by=assigned_by
    )


def _own_active_assignment(issue_id, actor):
    """Lock and return the issue's current assignment, which must belong to this officer."""
    profile = officer_profile_of(actor)
    if profile is None:
        raise PermissionDenied("You do not have an officer profile.")
    assignment = IssueAssignment.objects.select_for_update().filter(issue_id=issue_id, status__in=ACTIVE).first()
    if assignment is None or assignment.department_id != profile.department_id:
        raise PermissionDenied("This issue is not assigned to your department.")
    if assignment.officer_id != profile.id:
        raise PermissionDenied("This issue is assigned to a different officer.")
    return assignment


@transaction.atomic
def accept_assignment(*, issue_id, actor):
    """ASSIGNED -> IN_PROGRESS."""
    assignment = _own_active_assignment(issue_id, actor)
    if assignment.status != IssueAssignment.Status.PENDING:
        raise Conflict("This assignment has already been accepted.")
    issue_services.change_status(
        issue_id=issue_id, new_status=Issue.Status.IN_PROGRESS, changed_by=actor, reason="Accepted by officer"
    )
    assignment.status = IssueAssignment.Status.ACCEPTED
    assignment.accepted_at = timezone.now()
    assignment.save(update_fields=["status", "accepted_at"])
    return assignment


@transaction.atomic
def reject_assignment(*, issue_id, actor, reason):
    """ASSIGNED -> UNDER_REVIEW (back to the admin for reassignment). The reason is mandatory."""
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError({"reason": ["A reason is required to reject an assignment."]})
    assignment = _own_active_assignment(issue_id, actor)
    if assignment.status != IssueAssignment.Status.PENDING:
        raise Conflict("Only a pending assignment can be rejected; this one was already accepted.")
    issue_services.change_status(
        issue_id=issue_id,
        new_status=Issue.Status.UNDER_REVIEW,
        changed_by=actor,
        reason=f"Assignment rejected by officer: {reason}"[:255],
    )
    assignment.status = IssueAssignment.Status.REJECTED
    assignment.rejection_reason = reason
    assignment.save(update_fields=["status", "rejection_reason"])
    return assignment


def _attach_resolution_image(issue_id, upload):
    issue = Issue.objects.select_for_update().get(pk=issue_id)
    if issue.status != Issue.Status.IN_PROGRESS:
        raise Conflict("Resolution photos can only be added while the issue is in progress.")
    return issue_services.attach_image(issue, upload, IssueImage.ImageType.RESOLUTION)


@transaction.atomic
def add_resolution_image(*, issue_id, actor, upload):
    _own_active_assignment(issue_id, actor)
    return _attach_resolution_image(issue_id, upload)


@transaction.atomic
def resolve_issue(*, issue_id, actor, upload=None, remarks=""):
    """IN_PROGRESS -> RESOLVED. Needs >=1 RESOLUTION image: uploaded earlier, or in this very call."""
    assignment = _own_active_assignment(issue_id, actor)
    if assignment.status != IssueAssignment.Status.ACCEPTED:
        raise Conflict("Accept the assignment before resolving the issue.")
    if upload is not None:
        _attach_resolution_image(issue_id, upload)
    issue_services.change_status(
        issue_id=issue_id,
        new_status=Issue.Status.RESOLVED,
        changed_by=actor,
        reason=(remarks or "").strip() or "Resolved by officer",
    )
    return assignment


def add_note(*, issue_id, actor, note):
    """Any officer of the issue's department may add a private note."""
    profile = officer_profile_of(actor)
    if profile is None or not is_assigned_to_department(issue_id, profile.department_id):
        raise PermissionDenied("This issue is not assigned to your department.")
    return DepartmentNote.objects.create(issue_id=issue_id, officer=profile, note=note)


@transaction.atomic
def create_officer(*, email, full_name, password, department, employee_reference):
    """User (role=officer) + OfficerProfile in one atomic step: both exist or neither does."""
    if not department.is_active:
        raise ValidationError({"department": ["This department is not active."]})
    try:
        with transaction.atomic():
            user = User.objects.create_user(email=email, password=password, full_name=full_name, role=User.Role.OFFICER)
            return OfficerProfile.objects.create(
                user=user, department=department, employee_reference=employee_reference
            )
    except IntegrityError:
        # Lost a race with a concurrent request: the serializer's pre-checks passed, the DB constraint didn't.
        raise ValidationError("An account with this email or employee reference already exists.")
