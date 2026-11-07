import pytest
from django.urls import reverse

from issues.models import Issue, IssueStatusHistory

pytestmark = pytest.mark.django_db

LIST = "issue-list"


def detail(issue):
    return reverse("issue-detail", args=[issue.pk])


class TestCategories:
    def test_public_and_lists_seeded_active_categories(self, api):
        res = api.get(reverse("category-list"))
        assert res.status_code == 200
        names = {c["name"] for c in res.data}
        assert {"Pothole", "Garbage", "Streetlight"} <= names
        assert set(res.data[0]) == {"id", "name", "icon"}

    def test_inactive_category_hidden(self, api, category):
        category.is_active = False
        category.save()
        assert category.name not in {c["name"] for c in api.get(reverse("category-list")).data}


class TestCreate:
    def test_citizen_creates_issue(self, api, citizen, issue_payload):
        api.force_authenticate(citizen)
        res = api.post(reverse(LIST), issue_payload, format="json")
        assert res.status_code == 201, res.data
        assert res.data["status"] == "reported"
        assert res.data["priority"] == "medium"
        assert res.data["moderation_status"] == "pending"  # owner sees their own moderation state
        assert res.data["is_mine"] is True
        assert res.data["location"] == {"latitude": issue_payload["latitude"], "longitude": issue_payload["longitude"]}
        assert res.data["vote_count"] == 0
        issue = Issue.objects.get(pk=res.data["id"])
        assert issue.reporter == citizen
        assert IssueStatusHistory.objects.filter(issue=issue).count() == 1

    def test_client_cannot_set_server_controlled_fields(self, api, citizen, other_citizen, issue_payload):
        api.force_authenticate(citizen)
        payload = {
            **issue_payload,
            "status": "resolved",
            "priority": "critical",
            "moderation_status": "approved",
            "is_public": False,
            "reporter": str(other_citizen.pk),
            "resolved_at": "2020-01-01T00:00:00Z",
        }
        res = api.post(reverse(LIST), payload, format="json")
        assert res.status_code == 201
        issue = Issue.objects.get(pk=res.data["id"])
        assert issue.status == "reported"
        assert issue.priority == "medium"
        assert issue.moderation_status == "pending"
        assert issue.is_public is True
        assert issue.reporter == citizen
        assert issue.resolved_at is None

    def test_anonymous_gets_401(self, api, issue_payload):
        assert api.post(reverse(LIST), issue_payload, format="json").status_code == 401

    def test_officer_and_admin_cannot_create(self, api, officer, admin_user, issue_payload):
        for user in (officer, admin_user):
            api.force_authenticate(user)
            assert api.post(reverse(LIST), issue_payload, format="json").status_code == 403

    @pytest.mark.parametrize(
        "override",
        [
            {"latitude": 91},
            {"latitude": -91},
            {"longitude": 181},
            {"latitude": "abc"},
            {"title": "abc"},
            {"title": "x" * 151},
            {"description": "too short"},
            {"category": 999999},
        ],
    )
    def test_validation_errors(self, api, citizen, issue_payload, override):
        api.force_authenticate(citizen)
        res = api.post(reverse(LIST), {**issue_payload, **override}, format="json")
        assert res.status_code == 400
        assert not Issue.objects.exists()

    def test_missing_fields(self, api, citizen):
        api.force_authenticate(citizen)
        res = api.post(reverse(LIST), {}, format="json")
        assert res.status_code == 400
        assert {"category", "title", "description", "latitude", "longitude"} <= set(res.data)

    def test_inactive_category_rejected(self, api, citizen, issue_payload, category):
        category.is_active = False
        category.save()
        api.force_authenticate(citizen)
        assert api.post(reverse(LIST), issue_payload, format="json").status_code == 400


class TestListVisibility:
    def test_anonymous_sees_only_approved_public(self, api, citizen, make_issue):
        approved = make_issue(citizen, title="Approved public issue")
        make_issue(citizen, approved=False, title="Pending issue")
        make_issue(citizen, title="Rejected issue", moderation_status="rejected")
        make_issue(citizen, title="Approved but private", is_public=False)
        res = api.get(reverse(LIST))
        assert res.status_code == 200
        assert [i["id"] for i in res.data["results"]] == [str(approved.pk)]

    def test_public_list_hides_owner_only_fields_and_reporter(self, api, issue):
        item = api.get(reverse(LIST)).data["results"][0]
        assert "moderation_status" not in item and "is_public" not in item
        assert "reporter" not in item and item["is_mine"] is False

    def test_mine_requires_auth(self, api):
        assert api.get(reverse(LIST), {"mine": "true"}).status_code == 401

    def test_mine_includes_own_pending_and_rejected(self, api, citizen, make_issue):
        make_issue(citizen, title="Approved one")
        make_issue(citizen, approved=False, title="Pending one")
        make_issue(citizen, title="Rejected one", moderation_status="rejected")
        api.force_authenticate(citizen)
        res = api.get(reverse(LIST), {"mine": "true"})
        assert res.data["count"] == 3
        assert all(i["is_mine"] and "moderation_status" in i for i in res.data["results"])

    def test_mine_never_leaks_other_users_issues(self, api, citizen, other_citizen, make_issue):
        make_issue(citizen, approved=False, title="Citizen private pending")
        api.force_authenticate(other_citizen)
        assert api.get(reverse(LIST), {"mine": "true"}).data["count"] == 0
        assert api.get(reverse(LIST)).data["count"] == 0

    def test_without_mine_own_pending_not_in_public_list(self, api, citizen, make_issue):
        make_issue(citizen, approved=False)
        api.force_authenticate(citizen)
        assert api.get(reverse(LIST)).data["count"] == 0

    def test_filters(self, api, citizen, make_issue, category):
        make_issue(citizen)
        make_issue(citizen, status="in_progress")
        assert api.get(reverse(LIST), {"status": "in_progress"}).data["count"] == 1
        assert api.get(reverse(LIST), {"category": category.pk}).data["count"] == 2
        assert api.get(reverse(LIST), {"category": category.pk + 1000}).data["count"] == 0
        assert api.get(reverse(LIST), {"status": "bogus"}).status_code == 400
        assert api.get(reverse(LIST), {"category": "abc"}).status_code == 400

    def test_counts_and_viewer_flags(self, api, issue, citizen, other_citizen):
        from issues import services

        services.toggle_vote(issue=issue, user=other_citizen)
        services.toggle_follow(issue=issue, user=other_citizen)
        services.add_comment(issue=issue, user=citizen, content="visible")
        hidden = services.add_comment(issue=issue, user=citizen, content="hidden one")
        hidden.is_hidden = True
        hidden.save()
        api.force_authenticate(other_citizen)
        item = api.get(reverse(LIST)).data["results"][0]
        assert (item["vote_count"], item["comment_count"]) == (1, 1)
        assert (item["has_voted"], item["is_following"]) == (True, True)
        api.force_authenticate(citizen)
        item = api.get(reverse(LIST)).data["results"][0]
        assert (item["has_voted"], item["is_following"]) == (False, False)


class TestPriorityFilter:
    """GET /issues/?priority= -- same pattern as the category/status filters."""

    @pytest.fixture
    def mixed(self, citizen, make_issue):
        return {
            "low": make_issue(citizen, title="Low priority issue", priority="low"),
            "medium": make_issue(citizen, title="Medium priority issue", priority="medium"),
            "high": make_issue(citizen, title="High priority issue", priority="high"),
            "critical": make_issue(citizen, title="Critical priority issue", priority="critical"),
        }

    @pytest.mark.parametrize("priority", ["low", "medium", "high", "critical"])
    def test_returns_only_that_priority(self, api, mixed, priority):
        res = api.get(reverse(LIST), {"priority": priority})
        assert res.status_code == 200
        assert [i["id"] for i in res.data["results"]] == [str(mixed[priority].pk)]
        assert res.data["results"][0]["priority"] == priority

    def test_without_the_param_nothing_is_filtered(self, api, mixed):
        assert api.get(reverse(LIST)).data["count"] == 4

    @pytest.mark.parametrize("bad", ["urgent", "HIGH", "", "1", "high,low"])
    def test_invalid_value_is_400(self, api, mixed, bad):
        res = api.get(reverse(LIST), {"priority": bad})
        assert res.status_code == 400
        assert "priority" in res.data
        assert "low, medium, high, critical" in str(res.data["priority"])

    def test_combines_with_status_and_category(self, api, citizen, make_issue, category):
        match = make_issue(citizen, title="High and in progress", priority="high", status="in_progress")
        make_issue(citizen, title="High but reported", priority="high")
        make_issue(citizen, title="In progress but low", priority="low", status="in_progress")
        res = api.get(reverse(LIST), {"priority": "high", "status": "in_progress", "category": category.pk})
        assert [i["id"] for i in res.data["results"]] == [str(match.pk)]

    def test_still_only_shows_public_issues(self, api, citizen, make_issue):
        make_issue(citizen, title="Hidden high one", priority="high", approved=False)
        make_issue(citizen, title="Private high one", priority="high", is_public=False)
        visible = make_issue(citizen, title="Visible high one", priority="high")
        res = api.get(reverse(LIST), {"priority": "high"})
        assert [i["id"] for i in res.data["results"]] == [str(visible.pk)]

    def test_works_with_mine_for_the_owner_only(self, api, citizen, other_citizen, make_issue):
        mine = make_issue(citizen, title="My pending high one", priority="high", approved=False)
        make_issue(other_citizen, title="Their pending high one", priority="high", approved=False)
        api.force_authenticate(citizen)
        res = api.get(reverse(LIST), {"mine": "true", "priority": "high"})
        assert [i["id"] for i in res.data["results"]] == [str(mine.pk)]

    def test_pagination_keeps_the_filter(self, api, citizen, make_issue):
        for n in range(25):
            make_issue(citizen, title=f"High number {n:02d} issue", priority="high")
        make_issue(citizen, title="One low issue here", priority="low")
        first = api.get(reverse(LIST), {"priority": "high"}).data
        assert first["count"] == 25 and len(first["results"]) == 20 and "priority=high" in first["next"]
        second = api.get(reverse(LIST), {"priority": "high", "page": 2}).data
        assert len(second["results"]) == 5 and all(i["priority"] == "high" for i in second["results"])


class TestDetail:
    def test_public_issue_visible_to_anyone(self, api, issue):
        res = api.get(detail(issue))
        assert res.status_code == 200
        assert res.data["reference_number"] == issue.reference_number

    def test_pending_issue_visible_to_owner_only(self, api, citizen, other_citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        assert api.get(detail(pending)).status_code == 404
        api.force_authenticate(other_citizen)
        assert api.get(detail(pending)).status_code == 404
        api.force_authenticate(citizen)
        assert api.get(detail(pending)).status_code == 200

    def test_unknown_issue_404(self, api):
        import uuid

        assert api.get(reverse("issue-detail", args=[uuid.uuid4()])).status_code == 404
