import pytest
from django.urls import reverse

from accounts.models import User
from departments.models import DepartmentNote, IssueAssignment
from issues.models import Issue, IssueImage, IssueStatusHistory
from issues.tests.conftest import make_image_file

pytestmark = pytest.mark.django_db


def u(name, issue):
    return reverse(name, args=[issue.pk])


def history(issue):
    return list(IssueStatusHistory.objects.filter(issue=issue).order_by("created_at").values_list("old_status", "new_status"))


def resolution_image(issue):
    return IssueImage.objects.create(issue=issue, image="issues/x/done.png", image_type="resolution")


class TestAccessControl:
    ENDPOINTS = [
        ("get", "officer-issue-list", False),
        ("post", "officer-accept", True),
        ("post", "officer-reject", True),
        ("post", "officer-resolve", True),
        ("post", "officer-resolution-image", True),
        ("post", "officer-notes", True),
        ("get", "officer-notes", True),
    ]

    @pytest.mark.parametrize("method,name,needs_issue", ENDPOINTS)
    def test_anonymous_citizen_admin_and_profileless_officer_blocked(
        self, api, assigned_issue, citizen, admin_user, make_user, method, name, needs_issue
    ):
        url = u(name, assigned_issue) if needs_issue else reverse(name)
        assert getattr(api, method)(url).status_code == 401
        for user in (citizen, admin_user, make_user("noprofile@example.com", User.Role.OFFICER)):
            api.force_authenticate(user)
            assert getattr(api, method)(url).status_code == 403

    @pytest.mark.parametrize(
        "method,name,body",
        [
            ("post", "officer-accept", {}),
            ("post", "officer-reject", {"reason": "not ours"}),
            ("post", "officer-resolve", {}),
            ("post", "officer-notes", {"note": "x"}),
            ("get", "officer-notes", None),
        ],
    )
    def test_officer_of_other_department_gets_403_and_changes_nothing(
        self, api, assigned_issue, other_officer, method, name, body
    ):
        api.force_authenticate(other_officer.user)
        kwargs = {"format": "json"} if method == "post" else {}
        res = getattr(api, method)(u(name, assigned_issue), *([body] if body is not None else []), **kwargs)
        assert res.status_code == 403
        assigned_issue.refresh_from_db()
        assert assigned_issue.status == "assigned"
        assert not DepartmentNote.objects.exists()

    def test_unknown_issue_is_404(self, api, officer_profile):
        import uuid

        api.force_authenticate(officer_profile.user)
        assert api.post(reverse("officer-accept", args=[uuid.uuid4()])).status_code == 404


class TestList:
    def test_only_own_department_issues(self, api, officer_profile, other_officer, make_issue, citizen, put_in_state):
        mine = put_in_state(make_issue(citizen, title="Mine to handle"), "assigned", officer_profile)
        put_in_state(make_issue(citizen, title="Sanitation job"), "assigned", other_officer)
        make_issue(citizen, title="Nobody assigned yet")
        api.force_authenticate(officer_profile.user)
        res = api.get(reverse("officer-issue-list"))
        assert res.status_code == 200
        assert [i["id"] for i in res.data["results"]] == [str(mine.pk)]
        api.force_authenticate(other_officer.user)
        assert [i["title"] for i in api.get(reverse("officer-issue-list")).data["results"]] == ["Sanitation job"]

    def test_includes_assignment_and_hides_reporter_identity(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        item = api.get(reverse("officer-issue-list")).data["results"][0]
        assert item["assignment"]["status"] == "pending"
        assert item["assignment"]["officer"]["employee_reference"] == "EMP-001"
        assert item["assignment"]["department"]["name"] == "Public Works"
        assert "reporter" not in item

    def test_colleague_sees_it_too(self, api, colleague, assigned_issue):
        api.force_authenticate(colleague.user)
        assert api.get(reverse("officer-issue-list")).data["count"] == 1

    def test_rejected_and_superseded_assignments_leave_the_queue(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        IssueAssignment.objects.filter(issue=assigned_issue).update(status="rejected")
        assert api.get(reverse("officer-issue-list")).data["count"] == 0

    def test_status_filter(self, api, officer_profile, assigned_issue, make_issue, citizen, put_in_state):
        put_in_state(make_issue(citizen, title="Second one here"), "in_progress", officer_profile, "accepted")
        api.force_authenticate(officer_profile.user)
        assert api.get(reverse("officer-issue-list"), {"status": "in_progress"}).data["count"] == 1
        assert api.get(reverse("officer-issue-list")).data["count"] == 2
        assert api.get(reverse("officer-issue-list"), {"status": "bogus"}).status_code == 400


class TestAssignmentIsMine:
    """assignment.is_mine tells the UI whether the requester is the assigned officer (so it can offer or disable actions)."""

    def test_true_for_the_assigned_officer_false_for_a_colleague_and_admin(self, api, officer_profile, colleague, admin_user, assigned_issue):
        api.force_authenticate(officer_profile.user)
        assert api.get(u("officer-issue-detail", assigned_issue)).data["assignment"]["is_mine"] is True
        assert api.get(reverse("officer-issue-list")).data["results"][0]["assignment"]["is_mine"] is True
        api.force_authenticate(colleague.user)
        assert api.get(u("officer-issue-detail", assigned_issue)).data["assignment"]["is_mine"] is False
        api.force_authenticate(admin_user)
        assert api.get(u("admin-issue-detail", assigned_issue)).data["assignment"]["is_mine"] is False


class TestAccept:
    def test_accept_moves_to_in_progress(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        res = api.post(u("officer-accept", assigned_issue))
        assert res.status_code == 200, res.data
        assert res.data["status"] == "in_progress"
        assert res.data["assignment"]["status"] == "accepted"
        assert res.data["assignment"]["accepted_at"] is not None
        assert history(assigned_issue)[-1] == ("assigned", "in_progress")

    def test_cannot_accept_twice(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        api.post(u("officer-accept", assigned_issue))
        assert api.post(u("officer-accept", assigned_issue)).status_code == 409

    def test_cannot_accept_when_not_in_assigned_state(self, api, officer_profile, issue, put_in_state):
        put_in_state(issue, "under_review", officer_profile)  # stale pending assignment, wrong status
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-accept", issue)).status_code == 409
        issue.refresh_from_db()
        assert issue.status == "under_review"

    def test_colleague_cannot_act_on_issue_assigned_to_someone_else(self, api, colleague, assigned_issue):
        api.force_authenticate(colleague.user)
        assert api.post(u("officer-accept", assigned_issue)).status_code == 403
        assigned_issue.refresh_from_db()
        assert assigned_issue.status == "assigned"


class TestReject:
    def test_reject_with_reason_returns_to_under_review(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        res = api.post(u("officer-reject", assigned_issue), {"reason": "Belongs to the water board"}, format="json")
        assert res.status_code == 200, res.data
        assert res.data["status"] == "under_review"
        assert res.data["assignment"] is None  # out of the queue
        assignment = IssueAssignment.objects.get(issue=assigned_issue)
        assert (assignment.status, assignment.rejection_reason) == ("rejected", "Belongs to the water board")
        assert history(assigned_issue)[-1] == ("assigned", "under_review")
        last = IssueStatusHistory.objects.filter(issue=assigned_issue).latest("created_at")
        assert "Belongs to the water board" in last.reason
        assert api.get(reverse("officer-issue-list")).data["count"] == 0

    @pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}])
    def test_reason_required(self, api, officer_profile, assigned_issue, body):
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-reject", assigned_issue), body, format="json").status_code == 400
        assigned_issue.refresh_from_db()
        assert assigned_issue.status == "assigned"
        assert IssueAssignment.objects.get(issue=assigned_issue).status == "pending"

    def test_cannot_reject_after_accepting(self, api, officer_profile, in_progress_issue):
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-reject", in_progress_issue), {"reason": "changed my mind"}, format="json").status_code == 409


class TestResolve:
    def test_resolve_without_evidence_is_400(self, api, officer_profile, in_progress_issue):
        api.force_authenticate(officer_profile.user)
        res = api.post(u("officer-resolve", in_progress_issue), {}, format="json")
        assert res.status_code == 400
        assert "image" in res.data
        in_progress_issue.refresh_from_db()
        assert in_progress_issue.status == "in_progress" and in_progress_issue.resolved_at is None

    def test_resolve_with_inline_upload(self, api, officer_profile, in_progress_issue):
        api.force_authenticate(officer_profile.user)
        res = api.post(
            u("officer-resolve", in_progress_issue),
            {"image": make_image_file(), "remarks": "Filled and levelled"},
            format="multipart",
        )
        assert res.status_code == 200, res.data
        assert res.data["status"] == "resolved" and res.data["resolved_at"]
        assert [i["image_type"] for i in res.data["images"]] == ["resolution"]
        assert history(in_progress_issue)[-1] == ("in_progress", "resolved")
        assert IssueStatusHistory.objects.filter(issue=in_progress_issue).latest("created_at").reason == "Filled and levelled"

    def test_resolve_with_previously_uploaded_image(self, api, officer_profile, in_progress_issue):
        api.force_authenticate(officer_profile.user)
        up = api.post(u("officer-resolution-image", in_progress_issue), {"image": make_image_file()}, format="multipart")
        assert up.status_code == 201 and up.data["image_type"] == "resolution"
        res = api.post(u("officer-resolve", in_progress_issue), {}, format="json")
        assert res.status_code == 200 and res.data["status"] == "resolved"

    def test_invalid_inline_image_rolls_everything_back(self, api, officer_profile, in_progress_issue):
        from django.core.files.uploadedfile import SimpleUploadedFile

        api.force_authenticate(officer_profile.user)
        bad = SimpleUploadedFile("x.png", b"not an image", "image/png")
        assert api.post(u("officer-resolve", in_progress_issue), {"image": bad}, format="multipart").status_code == 400
        in_progress_issue.refresh_from_db()
        assert in_progress_issue.status == "in_progress"
        assert not IssueImage.objects.exists()

    def test_citizens_report_photo_does_not_count_as_evidence(self, api, officer_profile, in_progress_issue):
        IssueImage.objects.create(issue=in_progress_issue, image="issues/x/r.png", image_type="report")
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-resolve", in_progress_issue), {}, format="json").status_code == 400

    def test_must_accept_first(self, api, officer_profile, assigned_issue):
        resolution_image(assigned_issue)
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-resolve", assigned_issue), {}, format="json").status_code == 409
        assigned_issue.refresh_from_db()
        assert assigned_issue.status == "assigned"

    def test_cannot_resolve_twice(self, api, officer_profile, in_progress_issue):
        resolution_image(in_progress_issue)
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-resolve", in_progress_issue), {}, format="json").status_code == 200
        assert api.post(u("officer-resolve", in_progress_issue), {}, format="json").status_code == 409

    def test_resolution_images_capped(self, api, officer_profile, in_progress_issue):
        api.force_authenticate(officer_profile.user)
        for _ in range(5):
            assert api.post(u("officer-resolution-image", in_progress_issue), {"image": make_image_file()}, format="multipart").status_code == 201
        assert api.post(u("officer-resolution-image", in_progress_issue), {"image": make_image_file()}, format="multipart").status_code == 400

    def test_resolution_image_only_while_in_progress(self, api, officer_profile, assigned_issue):
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-resolution-image", assigned_issue), {"image": make_image_file()}, format="multipart").status_code == 409

    def test_resolution_photo_is_visible_publicly_on_the_issue(self, api, officer_profile, in_progress_issue):
        api.force_authenticate(officer_profile.user)
        api.post(u("officer-resolve", in_progress_issue), {"image": make_image_file()}, format="multipart")
        api.force_authenticate(None)
        public = api.get(reverse("issue-detail", args=[in_progress_issue.pk])).data
        assert public["status"] == "resolved"
        assert [i["image_type"] for i in public["images"]] == ["resolution"]


class TestNotes:
    def test_create_and_list(self, api, officer_profile, colleague, assigned_issue):
        api.force_authenticate(officer_profile.user)
        res = api.post(u("officer-notes", assigned_issue), {"note": "Need a roller from depot 2"}, format="json")
        assert res.status_code == 201
        assert res.data["author_name"] == officer_profile.user.full_name
        api.force_authenticate(colleague.user)  # same department can read and add
        api.post(u("officer-notes", assigned_issue), {"note": "Depot 2 confirmed"}, format="json")
        listing = api.get(u("officer-notes", assigned_issue))
        assert [n["note"] for n in listing.data["results"]] == ["Need a roller from depot 2", "Depot 2 confirmed"]

    @pytest.mark.parametrize("body", [{}, {"note": ""}, {"note": "   "}, {"note": "x" * 2001}])
    def test_note_validation(self, api, officer_profile, assigned_issue, body):
        api.force_authenticate(officer_profile.user)
        assert api.post(u("officer-notes", assigned_issue), body, format="json").status_code == 400
        assert not DepartmentNote.objects.exists()


class TestNotesNeverReachCitizens:
    SECRET = "INTERNAL-ONLY-SECRET-NOTE"

    def test_note_text_absent_from_every_citizen_and_public_response(
        self, api, officer_profile, assigned_issue, citizen, other_citizen
    ):
        api.force_authenticate(officer_profile.user)
        api.post(u("officer-notes", assigned_issue), {"note": self.SECRET}, format="json")
        pk = assigned_issue.pk
        api.force_authenticate(None)
        anon_responses = [
            api.get(reverse("issue-list")),
            api.get(reverse("issue-detail", args=[pk])),
            api.get(reverse("issue-comments", args=[pk])),
            api.get(reverse("issue-nearby"), {"lat": 22.7196, "lng": 75.8577}),
        ]
        for user in (citizen, other_citizen):  # citizen = the reporter
            api.force_authenticate(user)
            anon_responses += [
                api.get(reverse("issue-list")),
                api.get(reverse("issue-list"), {"mine": "true"}),
                api.get(reverse("issue-detail", args=[pk])),
            ]
        for res in anon_responses:
            assert res.status_code == 200
            assert self.SECRET not in res.content.decode()
            assert "department_notes" not in res.content.decode()

    def test_citizen_serializer_has_no_path_to_notes(self):
        from issues import serializers as citizen_serializers
        from issues.serializers import IssueSerializer, NearbyIssueSerializer

        for cls in (IssueSerializer, NearbyIssueSerializer):
            assert not [f for f in cls().fields if "note" in f]
        assert not hasattr(citizen_serializers, "DepartmentNoteSerializer")

    def test_notes_endpoint_closed_to_the_reporter(self, api, assigned_issue, citizen):
        api.force_authenticate(citizen)
        assert api.get(u("officer-notes", assigned_issue)).status_code == 403
        assert api.post(u("officer-notes", assigned_issue), {"note": "x"}, format="json").status_code == 403
