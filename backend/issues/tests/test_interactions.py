import uuid

import pytest
from django.urls import reverse

from issues import services
from issues.models import ContentReport, IssueComment, IssueFollow, IssueVote

pytestmark = pytest.mark.django_db


def u(name, obj):
    return reverse(name, args=[obj.pk])


class TestComments:
    def test_anonymous_can_read_visible_comments_only(self, api, issue, citizen):
        services.add_comment(issue=issue, user=citizen, content="Visible comment")
        hidden = services.add_comment(issue=issue, user=citizen, content="Hidden comment")
        hidden.is_hidden = True
        hidden.save()
        res = api.get(u("issue-comments", issue))
        assert res.status_code == 200
        assert [c["content"] for c in res.data["results"]] == ["Visible comment"]
        assert set(res.data["results"][0]) == {"id", "author_name", "content", "is_mine", "created_at"}

    def test_citizen_posts_comment(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        res = api.post(u("issue-comments", issue), {"content": "  Seen this too  "}, format="json")
        assert res.status_code == 201
        assert res.data["content"] == "Seen this too"
        assert res.data["is_mine"] is True
        assert IssueComment.objects.get().user == other_citizen

    @pytest.mark.parametrize("content", ["", "   ", "x" * 1001])
    def test_invalid_content(self, api, issue, other_citizen, content):
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-comments", issue), {"content": content}, format="json").status_code == 400
        assert not IssueComment.objects.exists()

    def test_anonymous_cannot_post_and_officer_forbidden(self, api, issue, officer):
        assert api.post(u("issue-comments", issue), {"content": "hi"}, format="json").status_code == 401
        api.force_authenticate(officer)
        assert api.post(u("issue-comments", issue), {"content": "hi"}, format="json").status_code == 403

    def test_cannot_comment_on_or_read_hidden_issue(self, api, citizen, other_citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        assert api.get(u("issue-comments", pending)).status_code == 404
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-comments", pending), {"content": "hello"}, format="json").status_code == 404

    def test_comment_cannot_set_hidden_flag_or_author(self, api, issue, citizen, other_citizen):
        api.force_authenticate(other_citizen)
        api.post(
            u("issue-comments", issue),
            {"content": "hello", "is_hidden": True, "user": str(citizen.pk)},
            format="json",
        )
        comment = IssueComment.objects.get()
        assert comment.is_hidden is False and comment.user == other_citizen


class TestVote:
    def test_toggle_via_api(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        on = api.post(u("issue-vote", issue))
        assert (on.status_code, on.data) == (200, {"voted": True, "vote_count": 1})
        off = api.post(u("issue-vote", issue))
        assert off.data == {"voted": False, "vote_count": 0}
        assert IssueVote.objects.count() == 0

    def test_one_vote_per_user(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        for _ in range(3):
            api.post(u("issue-vote", issue))
        assert IssueVote.objects.filter(issue=issue, user=other_citizen).count() == 1  # 3 toggles => on

    def test_requires_citizen(self, api, issue, officer):
        assert api.post(u("issue-vote", issue)).status_code == 401
        api.force_authenticate(officer)
        assert api.post(u("issue-vote", issue)).status_code == 403

    def test_cannot_vote_on_hidden_or_missing_issue(self, api, citizen, other_citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-vote", pending)).status_code == 404
        assert api.post(reverse("issue-vote", args=[uuid.uuid4()])).status_code == 404

    def test_get_not_allowed(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        assert api.get(u("issue-vote", issue)).status_code == 405


class TestFollow:
    def test_toggle_via_api(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-follow", issue)).data == {"following": True, "follower_count": 1}
        assert api.post(u("issue-follow", issue)).data == {"following": False, "follower_count": 0}
        assert IssueFollow.objects.count() == 0

    def test_access_rules(self, api, issue, officer, citizen, other_citizen, make_issue):
        assert api.post(u("issue-follow", issue)).status_code == 401
        api.force_authenticate(officer)
        assert api.post(u("issue-follow", issue)).status_code == 403
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-follow", pending)).status_code == 404


class TestReportIssue:
    def test_first_report_201_repeat_200_single_row(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        first = api.post(u("issue-report", issue), {"reason": "spam", "details": "ad"}, format="json")
        again = api.post(u("issue-report", issue), {"reason": "other"}, format="json")
        assert (first.status_code, again.status_code) == (201, 200)
        report = ContentReport.objects.get()
        assert (report.issue, report.comment, report.reason, report.reporter) == (issue, None, "spam", other_citizen)

    def test_invalid_reason(self, api, issue, other_citizen):
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-report", issue), {"reason": "nope"}, format="json").status_code == 400
        assert api.post(u("issue-report", issue), {}, format="json").status_code == 400

    def test_access_rules(self, api, issue, officer, citizen, other_citizen, make_issue):
        assert api.post(u("issue-report", issue), {"reason": "spam"}, format="json").status_code == 401
        api.force_authenticate(officer)
        assert api.post(u("issue-report", issue), {"reason": "spam"}, format="json").status_code == 403
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(other_citizen)
        assert api.post(u("issue-report", pending), {"reason": "spam"}, format="json").status_code == 404


class TestReportComment:
    def test_report_comment(self, api, issue, citizen, other_citizen):
        comment = services.add_comment(issue=issue, user=citizen, content="rude words")
        api.force_authenticate(other_citizen)
        first = api.post(u("comment-report", comment), {"reason": "inappropriate"}, format="json")
        again = api.post(u("comment-report", comment), {"reason": "inappropriate"}, format="json")
        assert (first.status_code, again.status_code) == (201, 200)
        report = ContentReport.objects.get()
        assert (report.comment, report.issue) == (comment, None)

    def test_hidden_comment_or_hidden_issue_is_404(self, api, citizen, other_citizen, issue, make_issue):
        hidden = services.add_comment(issue=issue, user=citizen, content="hidden")
        hidden.is_hidden = True
        hidden.save()
        pending = make_issue(citizen, approved=False)
        on_pending = services.add_comment(issue=pending, user=citizen, content="on pending")
        api.force_authenticate(other_citizen)
        assert api.post(u("comment-report", hidden), {"reason": "spam"}, format="json").status_code == 404
        assert api.post(u("comment-report", on_pending), {"reason": "spam"}, format="json").status_code == 404

    def test_requires_citizen(self, api, issue, citizen, officer):
        comment = services.add_comment(issue=issue, user=citizen, content="x")
        assert api.post(u("comment-report", comment), {"reason": "spam"}, format="json").status_code == 401
        api.force_authenticate(officer)
        assert api.post(u("comment-report", comment), {"reason": "spam"}, format="json").status_code == 403
