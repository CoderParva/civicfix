import pytest
from django.db import IntegrityError, transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from issues import services
from issues.exceptions import InvalidStatusTransition, IssueNotEditable
from issues.models import (
    ContentReport,
    Issue,
    IssueComment,
    IssueFollow,
    IssueStatusHistory,
    IssueVote,
)

pytestmark = pytest.mark.django_db


class TestCreateIssue:
    def test_defaults_are_server_controlled(self, issue_payload, citizen, category):
        issue = services.create_issue(
            reporter=citizen,
            category=category,
            **{k: v for k, v in issue_payload.items() if k != "category"},
        )
        assert issue.status == Issue.Status.REPORTED
        assert issue.priority == Issue.Priority.MEDIUM
        assert issue.moderation_status == Issue.ModerationStatus.PENDING
        assert issue.is_public is True
        assert issue.reference_number.startswith("CF-")
        assert (issue.location.y, issue.location.x) == (issue_payload["latitude"], issue_payload["longitude"])

    def test_writes_initial_status_history(self, issue):
        history = IssueStatusHistory.objects.get(issue=issue)
        assert (history.old_status, history.new_status) == ("", Issue.Status.REPORTED)
        assert history.changed_by == issue.reporter

    def test_reference_numbers_are_unique(self, make_issue, citizen):
        refs = {make_issue(citizen).reference_number for _ in range(5)}
        assert len(refs) == 5


class TestUniqueConstraints:
    def test_db_rejects_duplicate_vote(self, issue, other_citizen):
        IssueVote.objects.create(issue=issue, user=other_citizen)
        with pytest.raises(IntegrityError), transaction.atomic():
            IssueVote.objects.create(issue=issue, user=other_citizen)

    def test_db_rejects_duplicate_follow(self, issue, other_citizen):
        IssueFollow.objects.create(issue=issue, user=other_citizen)
        with pytest.raises(IntegrityError), transaction.atomic():
            IssueFollow.objects.create(issue=issue, user=other_citizen)

    def test_db_rejects_report_with_both_or_no_target(self, issue, other_citizen, citizen):
        comment = services.add_comment(issue=issue, user=citizen, content="hello")
        with pytest.raises(IntegrityError), transaction.atomic():
            ContentReport.objects.create(reporter=other_citizen, issue=issue, comment=comment, reason="spam")
        with pytest.raises(IntegrityError), transaction.atomic():
            ContentReport.objects.create(reporter=other_citizen, reason="spam")

    def test_db_rejects_duplicate_issue_report(self, issue, other_citizen):
        ContentReport.objects.create(reporter=other_citizen, issue=issue, reason="spam")
        with pytest.raises(IntegrityError), transaction.atomic():
            ContentReport.objects.create(reporter=other_citizen, issue=issue, reason="other")


class TestToggles:
    def test_vote_toggles_on_and_off(self, issue, other_citizen):
        assert services.toggle_vote(issue=issue, user=other_citizen) == (True, 1)
        assert services.toggle_vote(issue=issue, user=other_citizen) == (False, 0)
        assert services.toggle_vote(issue=issue, user=other_citizen) == (True, 1)

    def test_vote_counts_distinct_users(self, issue, citizen, other_citizen):
        services.toggle_vote(issue=issue, user=citizen)
        assert services.toggle_vote(issue=issue, user=other_citizen) == (True, 2)

    def test_follow_toggles(self, issue, other_citizen):
        assert services.toggle_follow(issue=issue, user=other_citizen) == (True, 1)
        assert services.toggle_follow(issue=issue, user=other_citizen) == (False, 0)

    def test_toggle_survives_concurrent_create(self, issue, other_citizen, monkeypatch):
        """If a parallel request inserts the row between our delete and create, we end up 'voted', not a 500."""
        # The competing request has already committed its row...
        IssueVote.objects.create(issue=issue, user=other_citizen)
        real_filter = IssueVote.objects.filter
        calls = []

        class _MissedDelete:
            def delete(self):
                return 0, {}  # ...but our delete ran before it was visible, so it removed nothing.

        def filter_(*args, **kwargs):
            calls.append(1)
            return _MissedDelete() if len(calls) == 1 else real_filter(*args, **kwargs)

        monkeypatch.setattr(IssueVote.objects, "filter", filter_)
        # Our create then hits the unique constraint: it must be swallowed, not raised.
        voted, count = services.toggle_vote(issue=issue, user=other_citizen)
        assert voted is True
        assert count == 1
        assert IssueVote.objects.filter(issue=issue, user=other_citizen).count() == 1


class TestComments:
    def test_add_comment(self, issue, other_citizen):
        comment = services.add_comment(issue=issue, user=other_citizen, content="Same here")
        assert IssueComment.objects.get() == comment
        assert comment.is_hidden is False


class TestStatusTransitionStub:
    @pytest.mark.parametrize("target", Issue.Status.values)
    def test_nothing_is_allowed_out_of_reported(self, issue, citizen, target):
        with pytest.raises(InvalidStatusTransition):
            services.change_status(issue_id=issue.pk, new_status=target, changed_by=citizen)
        issue.refresh_from_db()
        assert issue.status == Issue.Status.REPORTED
        assert IssueStatusHistory.objects.filter(issue=issue).count() == 1  # only the creation row

    def test_mechanism_updates_status_and_history_together(self, issue, officer, monkeypatch):
        """Proves the plumbing Phase 3 will use: validate -> update -> history, atomically."""
        monkeypatch.setitem(services.ALLOWED_TRANSITIONS, "reported", frozenset({"under_review"}))
        services.change_status(issue_id=issue.pk, new_status="under_review", changed_by=officer, reason="checked")
        issue.refresh_from_db()
        assert issue.status == "under_review"
        latest = IssueStatusHistory.objects.filter(issue=issue).latest("created_at")
        assert (latest.old_status, latest.new_status, latest.changed_by) == ("reported", "under_review", officer)

    def test_history_is_append_only(self, issue):
        row = IssueStatusHistory.objects.get(issue=issue)
        row.reason = "tampered"
        with pytest.raises(ValueError):
            row.save()


class TestUpdateIssueText:
    def test_owner_can_edit_title_and_description(self, issue, citizen):
        services.update_issue_text(issue_id=issue.pk, actor=citizen, title="New title here")
        issue.refresh_from_db()
        assert issue.title == "New title here"

    def test_non_owner_denied(self, issue, other_citizen):
        with pytest.raises(PermissionDenied):
            services.update_issue_text(issue_id=issue.pk, actor=other_citizen, title="Hijacked title")

    def test_not_editable_once_status_moves(self, issue, citizen):
        Issue.objects.filter(pk=issue.pk).update(status=Issue.Status.UNDER_REVIEW)
        with pytest.raises(IssueNotEditable):
            services.update_issue_text(issue_id=issue.pk, actor=citizen, title="Too late for edits")

    @pytest.mark.parametrize("field", ["status", "priority", "category", "location", "moderation_status", "reporter"])
    def test_service_rejects_fields_outside_allow_list(self, issue, citizen, field):
        with pytest.raises(ValidationError):
            services.update_issue_text(issue_id=issue.pk, actor=citizen, **{field: "x"})
