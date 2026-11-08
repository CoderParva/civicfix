from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from departments.models import IssueAssignment
from issues.models import ContentReport, Issue, IssueCategory

pytestmark = pytest.mark.django_db

ADMIN = "admin-analytics"
OFFICER = "officer-analytics"


def day(n):
    """`n` days ago, at noon local time (safe from midnight boundaries)."""
    return timezone.localtime().replace(hour=12, minute=0, second=0, microsecond=0) - timedelta(days=n)


def stamp(issue, created=None, resolved=None, **extra):
    fields = dict(extra)
    if created is not None:
        fields["created_at"] = created
    if resolved is not None:
        fields["resolved_at"] = resolved
    Issue.objects.filter(pk=issue.pk).update(**fields)
    issue.refresh_from_db()
    return issue


def get(api, user, name=ADMIN, **params):
    api.force_authenticate(user)
    return api.get(reverse(name), params)


class TestAccess:
    def test_admin_endpoint_is_admin_only(self, api, citizen, officer_profile):
        assert api.get(reverse(ADMIN)).status_code == 401
        for user in (citizen, officer_profile.user):
            assert get(api, user).status_code == 403

    def test_officer_endpoint_is_officer_with_a_department_only(self, api, citizen, admin_user, officer):
        assert api.get(reverse(OFFICER)).status_code == 401
        for user in (citizen, admin_user, officer):  # `officer` has no profile here
            assert get(api, user, OFFICER).status_code == 403


class TestPlatformAnalytics:
    def test_empty_database_is_all_zeros_not_an_error(self, api, admin_user):
        data = get(api, admin_user).data
        assert data["totals"] == {
            "issues": 0, "awaiting_moderation": 0, "open": 0, "resolved": 0, "rejected": 0, "flagged": 0, "avg_resolution_hours": None,
        }
        assert all(row["count"] == 0 for row in data["by_status"] + data["by_priority"])
        assert len(data["over_time"]) == 90 and all(r["reported"] == r["resolved"] == 0 for r in data["over_time"])
        assert data["departments"] == []

    def test_totals(self, api, admin_user, citizen, other_citizen, make_issue):
        make_issue(citizen, approved=False)  # awaiting moderation
        make_issue(citizen, status="under_review")  # open
        make_issue(citizen, status="in_progress")  # open
        make_issue(citizen, status="resolved")
        make_issue(citizen, status="rejected", moderation_status="rejected")
        flagged = make_issue(citizen, status="assigned")  # open
        ContentReport.objects.create(reporter=other_citizen, issue=flagged, reason="spam")
        ContentReport.objects.create(reporter=citizen, issue=flagged, reason="other")  # 2 reports, still 1 flagged issue
        totals = get(api, admin_user).data["totals"]
        assert totals == {
            "issues": 6, "awaiting_moderation": 1, "open": 3, "resolved": 1, "rejected": 1, "flagged": 1, "avg_resolution_hours": None,
        }

    def test_distributions_keep_zero_buckets_and_count_correctly(self, api, admin_user, citizen, make_issue, category):
        other = IssueCategory.objects.exclude(pk=category.pk).first()
        make_issue(citizen, priority="high", status="resolved")
        make_issue(citizen, priority="high", status="in_progress")
        make_issue(citizen, priority="low", category=other)
        data = get(api, admin_user).data
        status = {r["status"]: r["count"] for r in data["by_status"]}
        assert status["resolved"] == 1 and status["in_progress"] == 1 and status["reported"] == 1 and status["rejected"] == 0
        assert [r["status"] for r in data["by_status"]] == Issue.Status.values  # every status, in workflow order
        priority = {r["priority"]: r["count"] for r in data["by_priority"]}
        assert priority == {"low": 1, "medium": 0, "high": 2, "critical": 0}
        categories = {r["name"]: r["count"] for r in data["by_category"]}
        assert categories[category.name] == 2 and categories[other.name] == 1
        assert len(data["by_category"]) == IssueCategory.objects.count()  # zero-count categories included

    def test_over_time_buckets_by_day_and_fills_gaps(self, api, admin_user, citizen, make_issue):
        stamp(make_issue(citizen), created=day(3))
        stamp(make_issue(citizen), created=day(3))
        stamp(make_issue(citizen, status="resolved"), created=day(5), resolved=day(1))
        series = {r["date"]: r for r in get(api, admin_user, days=30).data["over_time"]}
        assert len(series) == 30
        assert series[day(3).date().isoformat()]["reported"] == 2
        assert series[day(5).date().isoformat()]["reported"] == 1
        assert series[day(1).date().isoformat()]["resolved"] == 1
        assert series[day(2).date().isoformat()] == {"date": day(2).date().isoformat(), "reported": 0, "resolved": 0}
        assert list(series) == sorted(series)  # ascending, contiguous
        assert list(series)[-1] == timezone.localdate().isoformat()

    def test_over_time_excludes_issues_older_than_the_window(self, api, admin_user, citizen, make_issue):
        stamp(make_issue(citizen), created=day(40))
        assert sum(r["reported"] for r in get(api, admin_user, days=30).data["over_time"]) == 0
        assert sum(r["reported"] for r in get(api, admin_user, days=60).data["over_time"]) == 1

    @pytest.mark.parametrize("days", [6, 366, 0, -1, "abc"])
    def test_days_is_validated(self, api, admin_user, days):
        assert get(api, admin_user, days=days).status_code == 400

    @pytest.mark.parametrize("days", [7, 365])
    def test_days_boundaries(self, api, admin_user, days):
        assert len(get(api, admin_user, days=days).data["over_time"]) == days

    def test_average_resolution_time_is_computed_from_real_timestamps(self, api, admin_user, citizen, make_issue):
        stamp(make_issue(citizen, status="resolved"), created=day(4), resolved=day(4) + timedelta(hours=10))
        stamp(make_issue(citizen, status="resolved"), created=day(3), resolved=day(3) + timedelta(hours=30))
        assert get(api, admin_user).data["totals"]["avg_resolution_hours"] == 20.0

    def test_department_performance(self, api, admin_user, citizen, make_issue, dept, other_dept, officer_profile, other_officer, put_in_state):
        now = timezone.now()
        done = put_in_state(make_issue(citizen), "resolved", officer_profile, "accepted")
        IssueAssignment.objects.filter(issue=done).update(assigned_at=now - timedelta(hours=48))
        stamp(done, resolved=now - timedelta(hours=24))  # 24h turnaround
        put_in_state(make_issue(citizen), "in_progress", officer_profile, "accepted")
        put_in_state(make_issue(citizen), "assigned", officer_profile, "pending")
        gone = put_in_state(make_issue(citizen), "under_review", other_officer, "rejected")  # a rejected hand-off
        rows = {r["name"]: r for r in get(api, admin_user).data["departments"]}
        pw, san = rows[dept.name], rows[other_dept.name]
        assert (pw["in_queue"], pw["in_progress"], pw["resolved"], pw["rejected_assignments"]) == (3, 1, 1, 0)
        assert pw["avg_resolution_hours"] == 24.0
        assert (san["in_queue"], san["resolved"], san["rejected_assignments"], san["avg_resolution_hours"]) == (0, 0, 1, None)
        assert gone is not None

    def test_superseded_assignments_do_not_count_toward_a_departments_queue(self, api, admin_user, citizen, make_issue, dept, officer_profile, put_in_state):
        put_in_state(make_issue(citizen), "in_progress", officer_profile, "superseded")
        assert get(api, admin_user).data["departments"][0]["in_queue"] == 0


class TestDepartmentAnalytics:
    def test_scoped_to_own_department_only(self, api, officer_profile, other_officer, citizen, make_issue, put_in_state):
        mine = put_in_state(make_issue(citizen, priority="high"), "in_progress", officer_profile, "accepted")
        put_in_state(make_issue(citizen, priority="critical"), "assigned", officer_profile, "pending")
        put_in_state(make_issue(citizen, priority="critical"), "in_progress", other_officer, "accepted")  # someone else's
        make_issue(citizen)  # unassigned
        data = get(api, officer_profile.user, OFFICER).data
        assert data["department"]["name"] == officer_profile.department.name
        assert data["totals"]["in_queue"] == 2 and data["totals"]["awaiting_acceptance"] == 1
        assert data["totals"]["in_progress"] == 1
        priority = {r["priority"]: r["count"] for r in data["by_priority"]}
        assert priority == {"low": 0, "medium": 0, "high": 1, "critical": 1}
        assert sum(r["reported"] for r in data["over_time"]) == 2
        assert mine is not None

    def test_a_colleague_sees_the_same_department_numbers(self, api, officer_profile, colleague, citizen, make_issue, put_in_state):
        put_in_state(make_issue(citizen), "assigned", officer_profile, "pending")
        assert get(api, officer_profile.user, OFFICER).data["totals"] == get(api, colleague.user, OFFICER).data["totals"]

    def test_empty_queue_is_zeros(self, api, officer_profile):
        data = get(api, officer_profile.user, OFFICER).data
        assert data["totals"] == {
            "in_queue": 0, "awaiting_acceptance": 0, "in_progress": 0, "resolved": 0, "rejected_assignments": 0, "avg_resolution_hours": None,
        }

    def test_turnaround_and_rejections(self, api, officer_profile, citizen, make_issue, put_in_state):
        now = timezone.now()
        done = put_in_state(make_issue(citizen), "resolved", officer_profile, "accepted")
        IssueAssignment.objects.filter(issue=done).update(assigned_at=now - timedelta(hours=10))
        stamp(done, resolved=now - timedelta(hours=4))
        put_in_state(make_issue(citizen), "under_review", officer_profile, "rejected")
        totals = get(api, officer_profile.user, OFFICER).data["totals"]
        assert totals["avg_resolution_hours"] == 6.0 and totals["rejected_assignments"] == 1 and totals["resolved"] == 1

    def test_days_param_validated(self, api, officer_profile):
        assert get(api, officer_profile.user, OFFICER, days=3).status_code == 400
        assert len(get(api, officer_profile.user, OFFICER, days=14).data["over_time"]) == 14
