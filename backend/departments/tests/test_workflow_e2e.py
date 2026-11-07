"""The whole lifecycle through the HTTP API, checking the history trail at the end."""
import pytest
from django.urls import reverse

from issues.models import IssueStatusHistory
from issues.tests.conftest import make_image_file

pytestmark = pytest.mark.django_db


def trail(issue_id):
    rows = IssueStatusHistory.objects.filter(issue_id=issue_id).order_by("created_at")
    return [(r.old_status, r.new_status) for r in rows]


def test_report_to_resolve_to_reopen_to_reassign(api, citizen, admin_user, dept, officer_profile, colleague, issue_payload):
    # citizen reports
    api.force_authenticate(citizen)
    created = api.post(reverse("issue-list"), issue_payload, format="json")
    assert created.status_code == 201
    issue_id = created.data["id"]
    assert api.get(reverse("issue-list")).data["count"] == 0  # pending: not public yet

    # admin approves, assigns
    api.force_authenticate(admin_user)
    assert api.post(reverse("admin-approve", args=[issue_id])).status_code == 200
    assign = {"department": str(dept.pk), "officer": str(officer_profile.pk)}
    assert api.post(reverse("admin-assign", args=[issue_id]), assign, format="json").status_code == 201

    # officer accepts and resolves with a photo
    api.force_authenticate(officer_profile.user)
    assert api.post(reverse("officer-accept", args=[issue_id])).status_code == 200
    api.post(reverse("officer-notes", args=[issue_id]), {"note": "Used cold-mix asphalt"}, format="json")
    done = api.post(reverse("officer-resolve", args=[issue_id]), {"image": make_image_file()}, format="multipart")
    assert done.status_code == 200 and done.data["status"] == "resolved"

    # citizen sees the outcome, but no notes
    api.force_authenticate(citizen)
    seen = api.get(reverse("issue-detail", args=[issue_id]))
    assert seen.data["status"] == "resolved" and "cold-mix" not in seen.content.decode()

    # admin reopens (reason mandatory), then reassigns to a colleague: REOPENED -> UNDER_REVIEW -> ASSIGNED
    api.force_authenticate(admin_user)
    assert api.post(reverse("admin-reopen", args=[issue_id]), {}, format="json").status_code == 400
    assert api.post(reverse("admin-reopen", args=[issue_id]), {"reason": "Hole reappeared"}, format="json").status_code == 200
    reassign = {"department": str(dept.pk), "officer": str(colleague.pk)}
    res = api.post(reverse("admin-assign", args=[issue_id]), reassign, format="json")
    assert res.status_code == 201 and res.data["assignment"]["officer"]["id"] == str(colleague.pk)

    assert trail(issue_id) == [
        ("", "reported"),
        ("reported", "under_review"),
        ("under_review", "assigned"),
        ("assigned", "in_progress"),
        ("in_progress", "resolved"),
        ("resolved", "reopened"),
        ("reopened", "under_review"),
        ("under_review", "assigned"),
    ]


def test_officer_rejection_flow_and_back_into_circulation(api, citizen, admin_user, dept, officer_profile, issue):
    from issues.models import Issue

    Issue.objects.filter(pk=issue.pk).update(status="under_review")
    api.force_authenticate(admin_user)
    api.post(reverse("admin-assign", args=[issue.pk]), {"department": str(dept.pk), "officer": str(officer_profile.pk)}, format="json")

    api.force_authenticate(officer_profile.user)
    assert api.post(reverse("officer-reject", args=[issue.pk]), {}, format="json").status_code == 400
    assert api.post(reverse("officer-reject", args=[issue.pk]), {"reason": "Not our road"}, format="json").status_code == 200

    api.force_authenticate(admin_user)
    listed = api.get(reverse("admin-issue-list"), {"status": "under_review"}).data["results"]
    assert [i["id"] for i in listed] == [str(issue.pk)] and listed[0]["assignment"] is None
    assert trail(issue.pk)[-2:] == [("under_review", "assigned"), ("assigned", "under_review")]
