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
    IssueImage,
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


# Independent copy of the spec -- deliberately NOT imported from services, so a typo there fails here.
EXPECTED_GRAPH = {
    "reported": {"under_review", "rejected"},
    "under_review": {"assigned", "rejected"},
    "assigned": {"in_progress", "under_review"},
    "in_progress": {"resolved"},
    "resolved": {"reopened"},
    "reopened": {"under_review"},
    "rejected": set(),
}
ALL_PAIRS = [(a, b) for a in Issue.Status.values for b in Issue.Status.values]


def _evidence(issue):
    IssueImage.objects.create(issue=issue, image="issues/x/evidence.png", image_type=IssueImage.ImageType.RESOLUTION)


class TestStatusTransitions:
    def test_graph_matches_spec_exactly(self):
        assert {k: set(v) for k, v in services.ALLOWED_TRANSITIONS.items()} == EXPECTED_GRAPH
        assert set(EXPECTED_GRAPH) == set(Issue.Status.values)  # no status left out of the graph

    @pytest.mark.parametrize("old,new", ALL_PAIRS)
    def test_every_pair(self, issue, officer, old, new):
        Issue.objects.filter(pk=issue.pk).update(status=old)
        issue.refresh_from_db()
        history_before = IssueStatusHistory.objects.filter(issue=issue).count()
        if new in EXPECTED_GRAPH[old]:
            if new == "resolved":
                _evidence(issue)
            services.change_status(issue_id=issue.pk, new_status=new, changed_by=officer, reason="because")
            issue.refresh_from_db()
            assert issue.status == new
            latest = IssueStatusHistory.objects.filter(issue=issue).latest("created_at")
            assert (latest.old_status, latest.new_status, latest.reason) == (old, new, "because")
            assert IssueStatusHistory.objects.filter(issue=issue).count() == history_before + 1
        else:
            with pytest.raises(InvalidStatusTransition):
                services.change_status(issue_id=issue.pk, new_status=new, changed_by=officer, reason="because")
            issue.refresh_from_db()
            assert issue.status == old
            assert IssueStatusHistory.objects.filter(issue=issue).count() == history_before

    def test_unknown_status_rejected(self, issue, officer):
        with pytest.raises(InvalidStatusTransition):
            services.change_status(issue_id=issue.pk, new_status="teleported", changed_by=officer)

    @pytest.mark.parametrize("old,new", [("reported", "rejected"), ("under_review", "rejected"), ("resolved", "reopened")])
    @pytest.mark.parametrize("reason", ["", "   ", None])
    def test_reason_mandatory_for_rejected_and_reopened(self, issue, officer, old, new, reason):
        Issue.objects.filter(pk=issue.pk).update(status=old)
        with pytest.raises(ValidationError) as exc:
            services.change_status(issue_id=issue.pk, new_status=new, changed_by=officer, reason=reason)
        assert "reason" in exc.value.detail
        issue.refresh_from_db()
        assert issue.status == old  # nothing changed

    def test_reason_not_required_elsewhere(self, issue, officer):
        services.change_status(issue_id=issue.pk, new_status="under_review", changed_by=officer)  # no reason
        issue.refresh_from_db()
        assert issue.status == "under_review"

    def test_resolved_needs_resolution_image(self, issue, officer):
        Issue.objects.filter(pk=issue.pk).update(status="in_progress")
        with pytest.raises(ValidationError) as exc:
            services.change_status(issue_id=issue.pk, new_status="resolved", changed_by=officer)
        assert "image" in exc.value.detail
        issue.refresh_from_db()
        assert issue.status == "in_progress" and issue.resolved_at is None

    def test_citizen_report_photo_is_not_resolution_evidence(self, issue, officer):
        Issue.objects.filter(pk=issue.pk).update(status="in_progress")
        IssueImage.objects.create(issue=issue, image="issues/x/report.png", image_type=IssueImage.ImageType.REPORT)
        with pytest.raises(ValidationError):
            services.change_status(issue_id=issue.pk, new_status="resolved", changed_by=officer)

    def test_resolve_sets_resolved_at_and_reopen_clears_it(self, issue, officer):
        Issue.objects.filter(pk=issue.pk).update(status="in_progress")
        _evidence(issue)
        services.change_status(issue_id=issue.pk, new_status="resolved", changed_by=officer)
        issue.refresh_from_db()
        assert issue.resolved_at is not None
        services.change_status(issue_id=issue.pk, new_status="reopened", changed_by=officer, reason="still broken")
        issue.refresh_from_db()
        assert issue.resolved_at is None

    def test_failed_transition_leaves_no_partial_write(self, issue, officer):
        Issue.objects.filter(pk=issue.pk).update(status="resolved", resolved_at=None)
        with pytest.raises(ValidationError):
            services.change_status(issue_id=issue.pk, new_status="reopened", changed_by=officer, reason="")
        assert IssueStatusHistory.objects.filter(issue=issue).count() == 1  # only the creation row

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
