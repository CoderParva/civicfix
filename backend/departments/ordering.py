"""`?ordering=` support for the staff issue lists (sortable table columns).

A whitelist of sort keys, never raw field names, so a client cannot sort by (or probe) arbitrary
columns. Status and priority sort by their *meaning* (workflow stage / urgency), not alphabetically.
"""
from django.db.models import Case, F, IntegerField, Value, When
from django.db.models.functions import Lower
from rest_framework.exceptions import ValidationError

from issues.models import Issue

STATUS_ORDER = [value for value, _ in Issue.Status.choices]  # reported ... rejected: workflow order
PRIORITY_ORDER = [value for value, _ in Issue.Priority.choices]  # low ... critical: ascending urgency

DEFAULT_ORDERING = "-created_at"


def _rank(field, order):
    return Case(*[When(**{field: v}, then=Value(i)) for i, v in enumerate(order)], output_field=IntegerField())


# key -> (annotation name or None, expression used for ordering)
_KEYS = {
    "created_at": (None, F("created_at")),
    "title": ("title_sort", Lower("title")),
    "status": ("status_rank", _rank("status", STATUS_ORDER)),
    "priority": ("priority_rank", _rank("priority", PRIORITY_ORDER)),
    "votes": (None, F("vote_count")),  # annotated by selectors.annotate_issues
    "reports": (None, F("report_count")),  # annotated by the admin list only
}

OFFICER_KEYS = ("created_at", "title", "status", "priority", "votes")
ADMIN_KEYS = OFFICER_KEYS + ("reports",)


def apply_ordering(queryset, value, allowed):
    """Order `queryset` by e.g. "priority" or "-priority". Ties fall back to newest-first, then pk."""
    value = value or DEFAULT_ORDERING
    descending = value.startswith("-")
    key = value[1:] if descending else value  # exactly one optional "-": "--title" is invalid
    if key not in allowed:
        raise ValidationError({"ordering": f"Must be one of: {', '.join(k + ', -' + k for k in allowed)}."})
    annotation, expression = _KEYS[key]
    if annotation:
        queryset = queryset.annotate(**{annotation: expression})
        expression = F(annotation)
    primary = expression.desc() if descending else expression.asc()
    return queryset.order_by(primary, "-created_at", "pk")
