import uuid

from django.db import models

from issues.models import Issue


class AIAnalysis(models.Model):
    """What the AI helpers said about one issue, kept for admins to review.

    One row per issue; each stage (priority rules, duplicate check, photo classification) fills in its
    part of `result` as it runs. Nothing here changes the issue itself: `suggested_priority` and
    `predicted_category` are suggestions, and the reporter's category / the admin's decisions stand.
    """

    class ProcessingStatus(models.TextChoices):
        COMPLETED = "completed", "Completed"  # every stage ran in full
        PARTIAL = "partial", "Partial"  # some stage was unavailable or degraded (e.g. no model installed)
        FAILED = "failed", "Failed"  # a stage raised unexpectedly; the issue itself was unaffected

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.OneToOneField(Issue, on_delete=models.CASCADE, related_name="ai_analysis")
    model_name = models.CharField(max_length=120, blank=True, help_text="The image classifier, if one ran.")
    model_version = models.CharField(max_length=60, blank=True)
    predicted_category = models.CharField(max_length=100, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    duplicate_score = models.FloatField(null=True, blank=True, help_text="Best match score among nearby reports.")
    suggested_priority = models.CharField(max_length=20, choices=Issue.Priority.choices, blank=True)
    processing_status = models.CharField(
        max_length=20, choices=ProcessingStatus.choices, default=ProcessingStatus.PARTIAL
    )
    result = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "AI analysis"
        verbose_name_plural = "AI analyses"

    def __str__(self):
        return f"AI analysis of {self.issue_id} ({self.processing_status})"
