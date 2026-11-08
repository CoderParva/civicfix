import pytest
from django.urls import reverse

from issues.models import IssueCategory, IssueVote
from accounts.models import User

pytestmark = pytest.mark.django_db

URL = "ai-priority"


def category(name):
    return IssueCategory.objects.get(name=name).pk


def test_recommends_from_a_draft_report_and_explains_itself(api, citizen):
    api.force_authenticate(citizen)
    res = api.post(
        reverse(URL),
        {"category": category("Pothole"), "title": "Hole near school", "description": "A child fell in, very dangerous."},
        format="json",
    )
    assert res.status_code == 200
    assert res.data["priority"] == "high" and res.data["method"] == "rules"
    assert [r["factor"] for r in res.data["reasons"]] == ["category", "safety risk"]
    assert res.data["score"] == sum(r["points"] for r in res.data["reasons"])


def test_votes_are_taken_into_account(api, citizen):
    api.force_authenticate(citizen)
    base = {"category": category("Garbage"), "title": "Rubbish", "description": "Heap of waste"}
    low = api.post(reverse(URL), base, format="json").data
    high = api.post(reverse(URL), {**base, "votes": 40}, format="json").data
    assert high["score"] == low["score"] + 3


def test_works_with_no_model_installed_and_with_one(api, citizen, ai_local):
    api.force_authenticate(citizen)
    res = api.post(reverse(URL), {"category": category("Pothole")}, format="json")
    assert res.status_code == 200 and res.data["priority"] == "medium"


def test_admin_can_score_an_existing_issue_with_its_real_votes_and_age(api, admin_user, issue, make_user):
    for n in range(5):
        IssueVote.objects.create(issue=issue, user=make_user(f"voter{n}@example.com", User.Role.CITIZEN))
    api.force_authenticate(admin_user)
    res = api.post(reverse(URL), {"issue_id": str(issue.pk)}, format="json")
    assert res.status_code == 200
    assert "community votes" in [r["factor"] for r in res.data["reasons"]]


def test_citizens_cannot_score_someone_elses_issue_by_id(api, citizen, issue):
    api.force_authenticate(citizen)
    assert api.post(reverse(URL), {"issue_id": str(issue.pk)}, format="json").status_code == 403


def test_validation_and_auth(api, citizen, officer):
    assert api.post(reverse(URL), {}, format="json").status_code == 401
    api.force_authenticate(officer)
    assert api.post(reverse(URL), {"category": 1}, format="json").status_code == 403
    api.force_authenticate(citizen)
    assert api.post(reverse(URL), {}, format="json").status_code == 400
    assert api.post(reverse(URL), {"category": 99999}, format="json").status_code == 400
    assert api.post(reverse(URL), {"category": category("Pothole"), "votes": -1}, format="json").status_code == 400
