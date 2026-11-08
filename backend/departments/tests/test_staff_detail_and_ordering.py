import pytest
from django.urls import reverse

from issues import services as issue_services
from issues.models import ContentReport, Issue

pytestmark = pytest.mark.django_db


def u(name, obj):
    return reverse(name, args=[obj.pk])


class TestOfficerDetail:
    def test_returns_the_issue_with_its_status_history_oldest_first(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        res = api.get(u("officer-issue-detail", assigned_issue))
        assert res.status_code == 200, res.data
        assert res.data["id"] == str(assigned_issue.pk)
        assert res.data["assignment"]["status"] == "pending"
        history = res.data["status_history"]
        assert [(h["old_status"], h["new_status"]) for h in history] == [("", "reported")]  # created by make_issue
        assert set(history[0]) == {"id", "old_status", "new_status", "changed_by", "reason", "created_at"}

    def test_history_shows_who_and_why_without_leaking_email(self, api, officer_profile, assigned_issue, admin_user):
        issue_services.change_status(issue_id=assigned_issue.pk, new_status="under_review", changed_by=officer_profile.user, reason="Not our road")
        api.force_authenticate(officer_profile.user)
        last = api.get(u("officer-issue-detail", assigned_issue)).data["status_history"][-1]
        assert last["new_status"] == "under_review" and last["reason"] == "Not our road"
        assert last["changed_by"] == {"name": officer_profile.user.full_name, "role": "officer"}
        assert officer_profile.user.email not in str(last)

    def test_history_row_survives_a_deleted_actor(self, api, officer_profile, assigned_issue, make_user):
        ghost = make_user("ghost@example.com", "officer")
        issue_services.change_status(issue_id=assigned_issue.pk, new_status="under_review", changed_by=ghost)
        ghost.delete()
        api.force_authenticate(officer_profile.user)
        last = api.get(u("officer-issue-detail", assigned_issue)).data["status_history"][-1]
        assert last["changed_by"] is None

    def test_other_department_gets_403_and_anonymous_401_and_citizen_403(self, api, assigned_issue, other_officer, citizen, admin_user):
        url = u("officer-issue-detail", assigned_issue)
        assert api.get(url).status_code == 401
        for user, code in ((other_officer.user, 403), (citizen, 403), (admin_user, 403)):
            api.force_authenticate(user)
            assert api.get(url).status_code == code

    def test_unknown_issue_is_404(self, api, officer_profile):
        import uuid

        api.force_authenticate(officer_profile.user)
        assert api.get(reverse("officer-issue-detail", args=[uuid.uuid4()])).status_code == 404


class TestAdminDetail:
    def test_pending_issue_with_history_reporter_and_flags(self, api, admin_user, citizen, other_citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        ContentReport.objects.create(reporter=other_citizen, issue=pending, reason="spam")
        api.force_authenticate(admin_user)
        res = api.get(u("admin-issue-detail", pending))
        assert res.status_code == 200
        assert res.data["moderation_status"] == "pending"
        assert res.data["reporter"]["email"] == citizen.email
        assert res.data["report_count"] == 1
        assert [(h["old_status"], h["new_status"]) for h in res.data["status_history"]] == [("", "reported")]
        assert res.data["status_history"][0]["changed_by"]["role"] == "citizen"

    def test_full_lifecycle_history_in_order(self, api, admin_user, dept, officer_profile, issue):
        Issue.objects.filter(pk=issue.pk).update(status="under_review")
        api.force_authenticate(admin_user)
        api.post(u("admin-assign", issue), {"department": str(dept.pk), "officer": str(officer_profile.pk)}, format="json")
        trail = [(h["old_status"], h["new_status"]) for h in api.get(u("admin-issue-detail", issue)).data["status_history"]]
        assert trail == [("", "reported"), ("under_review", "assigned")]

    @pytest.mark.parametrize("who", ["citizen", "officer"])
    def test_only_admin(self, api, issue, who, request):
        url = u("admin-issue-detail", issue)
        assert api.get(url).status_code == 401
        api.force_authenticate(request.getfixturevalue(who))
        assert api.get(url).status_code == 403

    def test_unknown_issue_is_404(self, api, admin_user):
        import uuid

        api.force_authenticate(admin_user)
        assert api.get(reverse("admin-issue-detail", args=[uuid.uuid4()])).status_code == 404


class TestOrdering:
    @pytest.fixture
    def mixed(self, citizen, make_issue):
        return {
            "a": make_issue(citizen, title="Alpha road", priority="low", status="resolved"),
            "b": make_issue(citizen, title="bravo drain", priority="critical", status="in_progress"),
            "c": make_issue(citizen, title="Charlie light", priority="high", status="under_review"),
            "d": make_issue(citizen, title="delta pit", priority="medium", status="assigned"),
        }

    def titles(self, res):
        return [i["title"] for i in res.data["results"]]

    def admin_get(self, api, admin_user, **params):
        api.force_authenticate(admin_user)
        return api.get(reverse("admin-issue-list"), params)

    def test_default_is_newest_first(self, api, admin_user, mixed):
        assert self.titles(self.admin_get(api, admin_user)) == ["delta pit", "Charlie light", "bravo drain", "Alpha road"]

    def test_title_sorts_case_insensitively(self, api, admin_user, mixed):
        assert self.titles(self.admin_get(api, admin_user, ordering="title")) == ["Alpha road", "bravo drain", "Charlie light", "delta pit"]
        assert self.titles(self.admin_get(api, admin_user, ordering="-title")) == ["delta pit", "Charlie light", "bravo drain", "Alpha road"]

    def test_priority_sorts_by_urgency_not_alphabet(self, api, admin_user, mixed):
        assert self.titles(self.admin_get(api, admin_user, ordering="priority")) == ["Alpha road", "delta pit", "Charlie light", "bravo drain"]
        assert self.titles(self.admin_get(api, admin_user, ordering="-priority")) == ["bravo drain", "Charlie light", "delta pit", "Alpha road"]

    def test_status_sorts_by_workflow_stage(self, api, admin_user, mixed):
        # under_review < assigned < in_progress < resolved
        assert self.titles(self.admin_get(api, admin_user, ordering="status")) == ["Charlie light", "delta pit", "bravo drain", "Alpha road"]

    def test_created_at_ascending(self, api, admin_user, mixed):
        assert self.titles(self.admin_get(api, admin_user, ordering="created_at")) == ["Alpha road", "bravo drain", "Charlie light", "delta pit"]

    def test_votes_and_reports(self, api, admin_user, mixed, other_citizen, citizen):
        issue_services.toggle_vote(issue=mixed["a"], user=citizen)
        issue_services.toggle_vote(issue=mixed["a"], user=other_citizen)
        issue_services.toggle_vote(issue=mixed["c"], user=citizen)
        ContentReport.objects.create(reporter=other_citizen, issue=mixed["d"], reason="spam")
        assert self.titles(self.admin_get(api, admin_user, ordering="-votes"))[:2] == ["Alpha road", "Charlie light"]
        assert self.titles(self.admin_get(api, admin_user, ordering="-reports"))[0] == "delta pit"

    @pytest.mark.parametrize("bad", ["priority,status", "colour", "-colour", "password", "reporter__password", "", "--title"])
    def test_invalid_ordering_is_400_for_admin(self, api, admin_user, mixed, bad):
        res = self.admin_get(api, admin_user, ordering=bad)
        if bad == "":
            assert res.status_code == 200  # an empty param means "default"
        else:
            assert res.status_code == 400 and "ordering" in res.data

    def test_ordering_survives_pagination(self, api, admin_user, citizen, make_issue):
        for n in range(25):
            make_issue(citizen, title=f"Row {n:02d}")
        first = self.admin_get(api, admin_user, ordering="title").data
        second = self.admin_get(api, admin_user, ordering="title", page=2).data
        names = [i["title"] for i in first["results"]] + [i["title"] for i in second["results"]]
        assert names == sorted(names) and len(names) == 25 and "ordering=title" in first["next"]

    def test_ties_are_stable(self, api, admin_user, citizen, make_issue):
        for n in range(6):
            make_issue(citizen, title=f"Same priority {n}", priority="medium")
        one = [i["id"] for i in self.admin_get(api, admin_user, ordering="priority").data["results"]]
        two = [i["id"] for i in self.admin_get(api, admin_user, ordering="priority").data["results"]]
        assert one == two

    def test_officer_list_orders_and_rejects_admin_only_keys(self, api, officer_profile, citizen, make_issue, put_in_state):
        for title, priority in (("Low one", "low"), ("Critical one", "critical"), ("Medium one", "medium")):
            put_in_state(make_issue(citizen, title=title, priority=priority), "assigned", officer_profile)
        api.force_authenticate(officer_profile.user)
        url = reverse("officer-issue-list")
        assert [i["title"] for i in api.get(url, {"ordering": "-priority"}).data["results"]] == ["Critical one", "Medium one", "Low one"]
        assert [i["title"] for i in api.get(url, {"ordering": "title"}).data["results"]] == ["Critical one", "Low one", "Medium one"]
        assert api.get(url, {"ordering": "reports"}).status_code == 400  # admin-only key
        assert api.get(url, {"ordering": "bogus"}).status_code == 400

    def test_filters_and_ordering_combine(self, api, admin_user, mixed):
        res = self.admin_get(api, admin_user, status="in_progress", ordering="-priority")
        assert self.titles(res) == ["bravo drain"]
