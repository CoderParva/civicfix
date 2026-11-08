"""All issue business logic. Views parse, call a service, serialize -- nothing more.

`Issue.status` is only ever written here (create_issue / change_status), in the same
transaction as its IssueStatusHistory row.
"""
import secrets
import string

from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .exceptions import Conflict, InvalidStatusTransition, IssueNotEditable
from .images import sanitize_image
from .models import (
    ContentReport,
    Issue,
    IssueComment,
    IssueFollow,
    IssueImage,
    IssueStatusHistory,
    IssueVote,
)

MAX_IMAGES_PER_ISSUE = 5
EDITABLE_FIELDS = frozenset({"title", "description"})

_S = Issue.Status

# The one place status transitions are defined and validated. REJECTED is terminal.
ALLOWED_TRANSITIONS = {
    _S.REPORTED: frozenset({_S.UNDER_REVIEW, _S.REJECTED}),
    _S.UNDER_REVIEW: frozenset({_S.ASSIGNED, _S.REJECTED}),
    _S.ASSIGNED: frozenset({_S.IN_PROGRESS, _S.UNDER_REVIEW}),
    _S.IN_PROGRESS: frozenset({_S.RESOLVED}),
    _S.RESOLVED: frozenset({_S.REOPENED}),
    _S.REOPENED: frozenset({_S.UNDER_REVIEW}),
    _S.REJECTED: frozenset(),
}
# Moving *into* these needs a human-readable reason in the history row.
REASON_REQUIRED = frozenset({_S.REJECTED, _S.REOPENED})


def _new_reference_number():
    alphabet = string.ascii_uppercase + string.digits
    prefix = f"CF-{timezone.localdate():%y%m}-"
    for _ in range(10):
        reference = prefix + "".join(secrets.choice(alphabet) for _ in range(6))
        if not Issue.objects.filter(reference_number=reference).exists():
            return reference
    raise RuntimeError("Could not allocate a unique reference number")  # the unique index is the backstop


@transaction.atomic
def create_issue(*, reporter, category, title, description, latitude, longitude, address="", landmark=""):
    issue = Issue.objects.create(
        reporter=reporter,
        category=category,
        title=title,
        description=description,
        location=Point(longitude, latitude, srid=4326),
        address=address,
        landmark=landmark,
        reference_number=_new_reference_number(),
        # status / priority / moderation_status deliberately left at model defaults:
        # REPORTED / MEDIUM / PENDING. Clients never choose them.
    )
    IssueStatusHistory.objects.create(
        issue=issue,
        old_status="",
        new_status=Issue.Status.REPORTED,
        changed_by=reporter,
        reason="Issue reported",
    )
    _run_ai_analysis(issue)
    return issue


def _run_ai_analysis(issue):
    """Inline, cheap AI stages (priority rules, duplicate check). Best effort: it must never fail a report."""
    from ai_engine import services as ai_services  # imported here: ai_engine depends on issues, not vice versa

    ai_services.safely(ai_services.analyze_new_issue, issue)


def analyze_photo(issue_id):
    """Record what the image model thinks of the issue's first photo. Best effort, never raises."""
    from ai_engine import services as ai_services

    ai_services.safely(ai_services.analyze_issue_image, issue_id)


@transaction.atomic
def update_issue_text(*, issue_id, actor, **fields):
    """Citizen edit: owner only, REPORTED only, title/description only."""
    forbidden = sorted(set(fields) - EDITABLE_FIELDS)
    if forbidden:
        raise ValidationError({name: "This field cannot be edited." for name in forbidden})

    issue = Issue.objects.select_for_update().get(pk=issue_id)  # lock: a status change can't race the edit
    if issue.reporter_id != actor.id:
        raise PermissionDenied("You can only edit your own issues.")
    if issue.status != Issue.Status.REPORTED:
        raise IssueNotEditable()

    for name, value in fields.items():
        setattr(issue, name, value)
    issue.save(update_fields=list(fields))
    return issue


@transaction.atomic
def change_status(*, issue_id, new_status, changed_by, reason=""):
    """The only way an issue's status changes: validated transition + history row, atomically.

    Order of checks: transition allowed -> reason present (REJECTED/REOPENED) -> evidence
    present (RESOLVED needs at least one RESOLUTION-type image).
    """
    issue = Issue.objects.select_for_update().get(pk=issue_id)
    old_status = issue.status
    if new_status not in ALLOWED_TRANSITIONS.get(old_status, frozenset()):
        raise InvalidStatusTransition(f"Cannot move an issue from '{old_status}' to '{new_status}'.")

    reason = (reason or "").strip()
    if new_status in REASON_REQUIRED and not reason:
        raise ValidationError({"reason": ["A reason is required for this status change."]})
    if new_status == Issue.Status.RESOLVED and not issue.images.filter(
        image_type=IssueImage.ImageType.RESOLUTION
    ).exists():
        raise ValidationError({"image": ["At least one resolution photo is required as evidence before resolving."]})

    issue.status = new_status
    if new_status == Issue.Status.RESOLVED:
        issue.resolved_at = timezone.now()
    elif new_status == Issue.Status.REOPENED:
        issue.resolved_at = None
    issue.save(update_fields=["status", "resolved_at"])
    IssueStatusHistory.objects.create(
        issue=issue, old_status=old_status, new_status=new_status, changed_by=changed_by, reason=reason
    )
    return issue


def _toggle(model, issue, user):
    """Create the (issue, user) row if absent, delete it if present. Race-safe via the unique constraint."""
    deleted, _ = model.objects.filter(issue=issue, user=user).delete()
    if deleted:
        return False
    try:
        with transaction.atomic():
            model.objects.create(issue=issue, user=user)
    except IntegrityError:
        pass  # a concurrent request created it first; the end state is still "present"
    return True


def toggle_vote(*, issue, user):
    voted = _toggle(IssueVote, issue, user)
    return voted, IssueVote.objects.filter(issue=issue).count()


def toggle_follow(*, issue, user):
    following = _toggle(IssueFollow, issue, user)
    return following, IssueFollow.objects.filter(issue=issue).count()


def add_comment(*, issue, user, content):
    return IssueComment.objects.create(issue=issue, user=user, content=content)


@transaction.atomic
def add_image(*, issue_id, actor, upload):
    issue = Issue.objects.select_for_update().get(pk=issue_id)
    if issue.reporter_id != actor.id:
        raise PermissionDenied("You can only add images to your own issues.")
    if issue.status != Issue.Status.REPORTED:
        raise IssueNotEditable("Images can only be added while the issue is in REPORTED status.")
    return attach_image(issue, upload, IssueImage.ImageType.REPORT)


def attach_image(issue, upload, image_type):
    """Validate/sanitise an upload and store it, enforcing the per-type cap. Caller holds the issue lock."""
    if issue.images.filter(image_type=image_type).count() >= MAX_IMAGES_PER_ISSUE:
        raise ValidationError({"image": [f"An issue can have at most {MAX_IMAGES_PER_ISSUE} images of this type."]})
    cleaned = sanitize_image(upload)
    return IssueImage.objects.create(issue=issue, image=cleaned, image_type=image_type)


def _report(reporter, reason, details, **target):
    report, created = ContentReport.objects.get_or_create(
        reporter=reporter, **target, defaults={"reason": reason, "details": details}
    )
    return report, created


def report_issue(*, issue, reporter, reason, details=""):
    return _report(reporter, reason, details, issue=issue)


def report_comment(*, comment, reporter, reason, details=""):
    return _report(reporter, reason, details, comment=comment)


# --------------------------------------------------------------------------------------
# Admin moderation. Each is one atomic action; status changes still go through change_status.
# --------------------------------------------------------------------------------------


@transaction.atomic
def approve_issue(*, issue_id, admin):
    """Moderation PENDING -> APPROVED and status REPORTED -> UNDER_REVIEW, in one action."""
    issue = Issue.objects.select_for_update().get(pk=issue_id)
    if issue.moderation_status != Issue.ModerationStatus.PENDING:
        raise Conflict("Only issues pending moderation can be approved.")
    if issue.status != Issue.Status.REPORTED:
        # The graph alone isn't enough: ASSIGNED/REOPENED -> UNDER_REVIEW are valid transitions,
        # but approval is only ever REPORTED -> UNDER_REVIEW.
        raise Conflict("Only issues in REPORTED status can be approved.")
    change_status(
        issue_id=issue_id, new_status=Issue.Status.UNDER_REVIEW, changed_by=admin, reason="Approved by moderator"
    )
    Issue.objects.filter(pk=issue_id).update(moderation_status=Issue.ModerationStatus.APPROVED)


@transaction.atomic
def reject_issue(*, issue_id, admin, reason):
    """Hide the issue (moderation REJECTED) *and* end its lifecycle (status REJECTED), with a reason.

    Both, because they answer different questions: moderation_status decides who can see the
    issue, status is the lifecycle the history/analytics read. Rejecting only one would leave
    a publicly visible "rejected" issue, or a hidden issue still marked as live.
    """
    Issue.objects.select_for_update().get(pk=issue_id)
    change_status(issue_id=issue_id, new_status=Issue.Status.REJECTED, changed_by=admin, reason=reason)
    Issue.objects.filter(pk=issue_id).update(moderation_status=Issue.ModerationStatus.REJECTED)
    from departments.services import release_assignments  # local import: departments depends on issues

    release_assignments(issue_id)


def reopen_issue(*, issue_id, admin, reason):
    """RESOLVED -> REOPENED. The reason is mandatory (enforced in change_status)."""
    return change_status(issue_id=issue_id, new_status=Issue.Status.REOPENED, changed_by=admin, reason=reason)


def hide_comment(*, comment_id, admin):
    """Moderation: hide a comment from public view. Idempotent. Returns (comment, changed)."""
    with transaction.atomic():
        comment = IssueComment.objects.select_for_update().get(pk=comment_id)
        if comment.is_hidden:
            return comment, False
        comment.is_hidden = True
        comment.save(update_fields=["is_hidden"])
        return comment, True
