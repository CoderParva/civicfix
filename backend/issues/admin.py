from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import (
    ContentReport,
    Issue,
    IssueCategory,
    IssueComment,
    IssueFollow,
    IssueImage,
    IssueStatusHistory,
    IssueVote,
)


@admin.register(IssueCategory)
class IssueCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "icon", "is_active")


@admin.register(Issue)
class IssueAdmin(GISModelAdmin):
    """Interim moderation tool until the Phase 3 admin endpoints exist."""

    list_display = ("reference_number", "title", "status", "moderation_status", "is_public", "created_at")
    list_filter = ("moderation_status", "status", "is_public", "category")
    search_fields = ("reference_number", "title")
    readonly_fields = ("reference_number", "status", "created_at", "resolved_at")  # status: never edited by hand
    actions = ["approve", "reject"]

    @admin.action(description="Approve selected issues (make publicly visible)")
    def approve(self, request, queryset):
        queryset.update(moderation_status=Issue.ModerationStatus.APPROVED)

    @admin.action(description="Reject selected issues")
    def reject(self, request, queryset):
        queryset.update(moderation_status=Issue.ModerationStatus.REJECTED)


@admin.register(IssueComment)
class IssueCommentAdmin(admin.ModelAdmin):
    list_display = ("issue", "user", "is_hidden", "created_at")
    list_filter = ("is_hidden",)


@admin.register(ContentReport)
class ContentReportAdmin(admin.ModelAdmin):
    list_display = ("reason", "issue", "comment", "reporter", "created_at")
    list_filter = ("reason",)


admin.site.register([IssueImage, IssueVote, IssueFollow, IssueStatusHistory])
