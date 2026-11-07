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

from .exceptions import InvalidStatusTransition, IssueNotEditable
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

# Phase 2 stub: nothing may leave any state. Phase 3's officer/admin endpoints will fill in
# the real graph here (e.g. REPORTED -> UNDER_REVIEW); it stays the single place transitions
# are validated.
ALLOWED_TRANSITIONS = {status: frozenset() for status in Issue.Status.values}


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
    return issue


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
    """Validated status transition + history row, atomically. Stub: every transition is rejected."""
    issue = Issue.objects.select_for_update().get(pk=issue_id)
    old_status = issue.status
    if new_status not in ALLOWED_TRANSITIONS.get(old_status, frozenset()):
        raise InvalidStatusTransition(f"Cannot move an issue from '{old_status}' to '{new_status}'.")

    issue.status = new_status
    if new_status == Issue.Status.RESOLVED:
        issue.resolved_at = timezone.now()
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
    if issue.images.count() >= MAX_IMAGES_PER_ISSUE:
        raise ValidationError({"image": [f"An issue can have at most {MAX_IMAGES_PER_ISSUE} images."]})

    cleaned = sanitize_image(upload)
    return IssueImage.objects.create(issue=issue, image=cleaned, image_type=IssueImage.ImageType.REPORT)


def _report(reporter, reason, details, **target):
    report, created = ContentReport.objects.get_or_create(
        reporter=reporter, **target, defaults={"reason": reason, "details": details}
    )
    return report, created


def report_issue(*, issue, reporter, reason, details=""):
    return _report(reporter, reason, details, issue=issue)


def report_comment(*, comment, reporter, reason, details=""):
    return _report(reporter, reason, details, comment=comment)
