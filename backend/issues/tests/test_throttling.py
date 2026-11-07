import pytest
from django.urls import reverse
from rest_framework.throttling import SimpleRateThrottle

from issues.models import Issue, IssueComment
from issues.tests.conftest import make_image_file

pytestmark = pytest.mark.django_db


@pytest.fixture
def tight(monkeypatch):
    """Shrink every issue-related rate to 2 requests so the limit is cheap to hit."""
    for scope in ("issue_create", "comment_create", "image_upload", "content_report"):
        monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, scope, "2/hour")


def test_configured_rates_exist():
    for scope in ("issue_create", "comment_create", "image_upload", "content_report"):
        assert scope in SimpleRateThrottle.THROTTLE_RATES


def test_issue_creation_is_rate_limited(api, citizen, issue_payload, tight):
    api.force_authenticate(citizen)
    codes = [api.post(reverse("issue-list"), issue_payload, format="json").status_code for _ in range(3)]
    assert codes == [201, 201, 429]
    assert Issue.objects.count() == 2


def test_comments_are_rate_limited(api, issue, other_citizen, tight):
    api.force_authenticate(other_citizen)
    url = reverse("issue-comments", args=[issue.pk])
    codes = [api.post(url, {"content": f"comment {i}"}, format="json").status_code for i in range(3)]
    assert codes == [201, 201, 429]
    assert IssueComment.objects.count() == 2


def test_reports_and_uploads_are_rate_limited(api, citizen, issue, other_citizen, make_issue, tight):
    api.force_authenticate(other_citizen)
    url = reverse("issue-report", args=[issue.pk])
    assert [api.post(url, {"reason": "spam"}, format="json").status_code for _ in range(3)] == [201, 200, 429]

    api.force_authenticate(citizen)
    up = reverse("issue-images", args=[issue.pk])
    codes = [api.post(up, {"image": make_image_file()}, format="multipart").status_code for _ in range(3)]
    assert codes == [201, 201, 429]


def test_limit_is_per_user_not_global(api, citizen, other_citizen, issue_payload, tight):
    for user in (citizen, other_citizen):
        api.force_authenticate(user)
        assert api.post(reverse("issue-list"), issue_payload, format="json").status_code == 201


def test_reading_is_never_throttled(api, issue, tight):
    for _ in range(10):
        assert api.get(reverse("issue-list")).status_code == 200
        assert api.get(reverse("issue-comments", args=[issue.pk])).status_code == 200
