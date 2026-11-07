import pytest
from django.urls import reverse

from issues.models import Issue

pytestmark = pytest.mark.django_db


def url(issue):
    return reverse("issue-detail", args=[issue.pk])


class TestPatchAllowList:
    def test_owner_edits_title_and_description(self, api, citizen, issue):
        api.force_authenticate(citizen)
        res = api.patch(url(issue), {"title": "Updated pothole title", "description": "Updated description text."}, format="json")
        assert res.status_code == 200
        issue.refresh_from_db()
        assert issue.title == "Updated pothole title"
        assert issue.description == "Updated description text."

    @pytest.mark.parametrize(
        "body",
        [
            {"status": "resolved"},
            {"priority": "critical"},
            {"category": 1},
            {"moderation_status": "approved"},
            {"is_public": False},
            {"reporter": "00000000-0000-0000-0000-000000000000"},
            {"location": {"latitude": 1, "longitude": 1}},
            {"title": "A valid new title", "status": "reopened"},  # one good field must not smuggle a bad one
        ],
    )
    def test_fields_outside_allow_list_rejected_and_nothing_changes(self, api, citizen, issue, body):
        before = Issue.objects.values().get(pk=issue.pk)
        api.force_authenticate(citizen)
        res = api.patch(url(issue), body, format="json")
        assert res.status_code == 400
        assert Issue.objects.values().get(pk=issue.pk) == before

    def test_empty_patch_rejected(self, api, citizen, issue):
        api.force_authenticate(citizen)
        assert api.patch(url(issue), {}, format="json").status_code == 400

    def test_field_validation_applies(self, api, citizen, issue):
        api.force_authenticate(citizen)
        assert api.patch(url(issue), {"title": "abc"}, format="json").status_code == 400

    @pytest.mark.parametrize("current", [s for s in Issue.Status.values if s != "reported"])
    def test_only_while_reported(self, api, citizen, issue, current):
        Issue.objects.filter(pk=issue.pk).update(status=current)
        api.force_authenticate(citizen)
        res = api.patch(url(issue), {"title": "Attempted late edit"}, format="json")
        assert res.status_code == 409
        issue.refresh_from_db()
        assert issue.title != "Attempted late edit"

    def test_put_not_allowed(self, api, citizen, issue):
        api.force_authenticate(citizen)
        assert api.put(url(issue), {"title": "Replaced title"}, format="json").status_code == 405


class TestIdor:
    def test_other_citizen_cannot_edit_public_issue(self, api, other_citizen, issue):
        api.force_authenticate(other_citizen)
        res = api.patch(url(issue), {"title": "Hijacked by someone"}, format="json")
        assert res.status_code == 403
        issue.refresh_from_db()
        assert issue.title != "Hijacked by someone"

    def test_other_citizen_gets_404_for_hidden_issue(self, api, citizen, other_citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(other_citizen)
        assert api.patch(url(pending), {"title": "Hijacked by someone"}, format="json").status_code == 404

    def test_anonymous_gets_401(self, api, issue):
        assert api.patch(url(issue), {"title": "Anonymous edit try"}, format="json").status_code == 401

    def test_officer_and_admin_cannot_use_citizen_patch(self, api, officer, admin_user, issue):
        for user in (officer, admin_user):
            api.force_authenticate(user)
            assert api.patch(url(issue), {"title": "Staff edit attempt"}, format="json").status_code == 403

    def test_owner_can_edit_own_pending_issue(self, api, citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(citizen)
        assert api.patch(url(pending), {"title": "Fixing a typo here"}, format="json").status_code == 200
