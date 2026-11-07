import uuid

from django.conf import settings
from django.contrib.gis.db import models
from django.db.models import Q


class IssueCategory(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=100, unique=True)
    icon = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "issue categories"

    def __str__(self):
        return self.name


class Issue(models.Model):
    class Status(models.TextChoices):
        REPORTED = "reported", "Reported"
        UNDER_REVIEW = "under_review", "Under review"
        ASSIGNED = "assigned", "Assigned"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"
        REOPENED = "reopened", "Reopened"
        REJECTED = "rejected", "Rejected"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    class ModerationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference_number = models.CharField(max_length=20, unique=True, editable=False)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="issues")
    category = models.ForeignKey(IssueCategory, on_delete=models.PROTECT, related_name="issues")
    title = models.CharField(max_length=150)
    description = models.TextField(max_length=2000)
    # Never written directly from a view: only services.create_issue / services.change_status.
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REPORTED)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    location = models.PointField(geography=True, srid=4326)
    address = models.CharField(max_length=255, blank=True)
    landmark = models.CharField(max_length=255, blank=True)
    is_public = models.BooleanField(default=True)
    moderation_status = models.CharField(
        max_length=20, choices=ModerationStatus.choices, default=ModerationStatus.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["moderation_status", "is_public", "-created_at"], name="issue_public_feed_idx"),
            models.Index(fields=["reporter", "-created_at"], name="issue_reporter_idx"),
            models.Index(fields=["status"], name="issue_status_idx"),
        ]

    def __str__(self):
        return f"{self.reference_number} {self.title}"


def issue_image_path(instance, filename):
    # The service names the file from the *detected* format, never the client's filename.
    return f"issues/{instance.issue_id}/{uuid.uuid4().hex}.{filename.rsplit('.', 1)[-1]}"


class IssueImage(models.Model):
    class ImageType(models.TextChoices):
        REPORT = "report", "Reported by citizen"
        RESOLUTION = "resolution", "Resolution proof"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to=issue_image_path)
    image_type = models.CharField(max_length=20, choices=ImageType.choices, default=ImageType.REPORT)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    @property
    def image_url(self):
        return self.image.url


class IssueVote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="issue_votes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["issue", "user"], name="unique_vote_per_user_issue")]


class IssueFollow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="follows")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="issue_follows")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["issue", "user"], name="unique_follow_per_user_issue")]


class IssueComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="issue_comments")
    content = models.TextField(max_length=1000)
    is_hidden = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class IssueStatusHistory(models.Model):
    """Append-only audit trail of status changes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="status_history")
    old_status = models.CharField(max_length=20, blank=True)
    new_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="status_changes"
    )
    reason = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name_plural = "issue status history"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("IssueStatusHistory is append-only")
        super().save(*args, **kwargs)


class ContentReport(models.Model):
    """A citizen flagging an issue or a comment as inappropriate (the two gap endpoints in the plan)."""

    class Reason(models.TextChoices):
        SPAM = "spam", "Spam"
        INAPPROPRIATE = "inappropriate", "Inappropriate or offensive"
        MISLEADING = "misleading", "False or misleading"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_reports")
    issue = models.ForeignKey(Issue, null=True, blank=True, on_delete=models.CASCADE, related_name="content_reports")
    comment = models.ForeignKey(
        IssueComment, null=True, blank=True, on_delete=models.CASCADE, related_name="content_reports"
    )
    reason = models.CharField(max_length=20, choices=Reason.choices)
    details = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(issue__isnull=False, comment__isnull=True) | Q(issue__isnull=True, comment__isnull=False)),
                name="content_report_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["reporter", "issue"], condition=Q(issue__isnull=False), name="unique_issue_report_per_user"
            ),
            models.UniqueConstraint(
                fields=["reporter", "comment"], condition=Q(comment__isnull=False), name="unique_comment_report_per_user"
            ),
        ]
