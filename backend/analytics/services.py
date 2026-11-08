"""Dashboard aggregates, computed by the database. No hardcoded numbers, no client-side tallying."""
from datetime import timedelta

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from django.db.models.functions import TruncDate
from django.utils import timezone

from departments.models import Department, IssueAssignment
from departments.selectors import issues_assigned_to
from issues.models import Issue, IssueCategory

OPEN_STATUSES = (Issue.Status.UNDER_REVIEW, Issue.Status.ASSIGNED, Issue.Status.IN_PROGRESS, Issue.Status.REOPENED)
HOURS = 3600


def _hours(delta):
    return None if delta is None else round(delta.total_seconds() / HOURS, 1)


def _distributions(issues):
    """Issue counts by status, priority and category. Zero buckets are kept so charts and legends are stable."""
    by_status = dict(issues.values_list("status").annotate(n=Count("id")))
    by_priority = dict(issues.values_list("priority").annotate(n=Count("id")))
    by_category = dict(issues.values_list("category_id").annotate(n=Count("id")))
    categories = IssueCategory.objects.order_by("id")
    return {
        "by_status": [{"status": s, "count": by_status.get(s, 0)} for s in Issue.Status.values],
        "by_priority": [{"priority": p, "count": by_priority.get(p, 0)} for p in Issue.Priority.values],
        "by_category": [{"id": c.id, "name": c.name, "count": by_category.get(c.id, 0)} for c in categories],
    }


def _over_time(issues, days):
    """One row per day for the last `days` days: issues reported that day and issues resolved that day."""
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    reported = dict(
        issues.filter(created_at__date__gte=start)
        .annotate(day=TruncDate("created_at"))
        .values_list("day")
        .annotate(n=Count("id"))
    )
    resolved = dict(
        issues.filter(resolved_at__date__gte=start)
        .annotate(day=TruncDate("resolved_at"))
        .values_list("day")
        .annotate(n=Count("id"))
    )
    rows = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        rows.append({"date": day.isoformat(), "reported": reported.get(day, 0), "resolved": resolved.get(day, 0)})
    return rows


def _turnaround(assignments):
    """Average time from assignment to resolution, for resolved issues only (None when there are none)."""
    spent = ExpressionWrapper(F("issue__resolved_at") - F("assigned_at"), output_field=DurationField())
    return assignments.filter(issue__status=Issue.Status.RESOLVED).aggregate(avg=Avg(spent))["avg"]


def platform_analytics(days=90):
    issues = Issue.objects.all()
    resolved = issues.filter(status=Issue.Status.RESOLVED, resolved_at__isnull=False)
    avg_resolution = resolved.aggregate(avg=Avg(ExpressionWrapper(F("resolved_at") - F("created_at"), output_field=DurationField())))["avg"]
    totals = {
        "issues": issues.count(),
        "awaiting_moderation": issues.filter(moderation_status=Issue.ModerationStatus.PENDING).count(),
        "open": issues.filter(moderation_status=Issue.ModerationStatus.APPROVED, status__in=OPEN_STATUSES).count(),
        "resolved": issues.filter(status=Issue.Status.RESOLVED).count(),
        "rejected": issues.filter(status=Issue.Status.REJECTED).count(),
        "flagged": issues.filter(content_reports__isnull=False).distinct().count(),
        "avg_resolution_hours": _hours(avg_resolution),
    }

    # Department performance: the issues currently in each department's queue.
    queue = IssueAssignment.objects.filter(status__in=IssueAssignment.ACTIVE_STATUSES)
    spent = ExpressionWrapper(F("issue__resolved_at") - F("assigned_at"), output_field=DurationField())
    per_department = {
        row["department_id"]: row
        for row in queue.values("department_id").annotate(
            in_queue=Count("id"),
            in_progress=Count("id", filter=Q(issue__status=Issue.Status.IN_PROGRESS)),
            resolved=Count("id", filter=Q(issue__status=Issue.Status.RESOLVED)),
            avg=Avg(spent, filter=Q(issue__status=Issue.Status.RESOLVED)),
        )
    }
    rejected = dict(
        IssueAssignment.objects.filter(status=IssueAssignment.Status.REJECTED).values_list("department_id").annotate(n=Count("id"))
    )
    departments = []
    for department in Department.objects.order_by("name"):
        row = per_department.get(department.id, {})
        departments.append(
            {
                "id": str(department.id),
                "name": department.name,
                "city": department.city,
                "is_active": department.is_active,
                "in_queue": row.get("in_queue", 0),
                "in_progress": row.get("in_progress", 0),
                "resolved": row.get("resolved", 0),
                "rejected_assignments": rejected.get(department.id, 0),
                "avg_resolution_hours": _hours(row.get("avg")),
            }
        )

    return {
        "range_days": days,
        "totals": totals,
        **_distributions(issues),
        "over_time": _over_time(issues, days),
        "departments": departments,
    }


def department_analytics(department, days=90):
    """The same shapes, scoped to the issues currently in one department's queue."""
    issues = issues_assigned_to(department)
    assignments = IssueAssignment.objects.filter(department=department, status__in=IssueAssignment.ACTIVE_STATUSES)
    totals = {
        "in_queue": issues.count(),
        "awaiting_acceptance": assignments.filter(status=IssueAssignment.Status.PENDING).count(),
        "in_progress": issues.filter(status=Issue.Status.IN_PROGRESS).count(),
        "resolved": issues.filter(status=Issue.Status.RESOLVED).count(),
        "rejected_assignments": IssueAssignment.objects.filter(
            department=department, status=IssueAssignment.Status.REJECTED
        ).count(),
        "avg_resolution_hours": _hours(_turnaround(assignments)),
    }
    return {
        "range_days": days,
        "department": {"id": str(department.id), "name": department.name, "city": department.city},
        "totals": totals,
        **_distributions(issues),
        "over_time": _over_time(issues, days),
    }
