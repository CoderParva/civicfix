import uuid

import pytest
from django.urls import reverse

from departments.models import Department, IssueAssignment
from issues import services
from issues.models import ContentReport, Issue, IssueStatusHistory

pytestmark = pytest.mark.django_db


def u(name, obj):
    return reverse(name, args=[obj.pk])


def history(issue):
    return list(IssueStatusHistory.objects.filter(issue=issue).order_by("created_at").values_list("old_status", "new_status"))


def assign_body(dept, profile):
    return {"department": str(dept.pk), "officer": str(profile.pk)}


class TestAccessControl:
    @pytest.mark.parametrize(
        "method,name,use_issue,use_comment",
        [
            ("get", "admin-issue-list", False, False),
            ("post", "admin-approve", True, False),
            ("post", "admin-reject", True, False),
            ("post", "admin-assign", True, False),
            ("post", "admin-reopen", True, False),
            ("post", "admin-hide-comment", False, True),
            ("get", "admin-department-list", False, False),
            ("post", "admin-department-list", False, False),
        ],
    )
    def test_only_super_admin(self, api, issue, citizen, officer, admin_user, method, name, use_issue, use_comment):
        comment = services.add_comment(issue=issue, user=citizen, content="hi")
        url = u(name, issue) if use_issue else u(name, comment) if use_comment else reverse(name)
        assert getattr(api, method)(url).status_code == 401
        for user in (citizen, officer):
            api.force_authenticate(user)
            assert getattr(api, method)(url).status_code == 403
        api.force_authenticate(admin_user)
        assert getattr(api, method)(url).status_code != 403

    def test_department_detail_endpoints_closed_to_non_admins(self, api, dept, citizen, officer):
        url = u("admin-department-detail", dept)
        for user in (citizen, officer):
            api.force_authenticate(user)
            for method in ("get", "patch", "delete"):
                assert getattr(api, method)(url).status_code == 403


class TestIssueList:
    def test_sees_everything_regardless_of_moderation_state(self, api, admin_user, citizen, make_issue):
        make_issue(citizen, title="Approved issue")
        make_issue(citizen, approved=False, title="Pending issue")
        make_issue(citizen, title="Rejected issue", moderation_status="rejected")
        make_issue(citizen, title="Private issue", is_public=False)
        api.force_authenticate(admin_user)
        res = api.get(reverse("admin-issue-list"))
        assert res.data["count"] == 4
        item = res.data["results"][0]
        assert {"moderation_status", "is_public", "reporter", "report_count", "assignment"} <= set(item)
        assert item["reporter"]["email"] == citizen.email

    def test_filters(self, api, admin_user, citizen, make_issue, other_citizen):
        pending = make_issue(citizen, approved=False, title="Pending issue")
        flagged = make_issue(citizen, title="Flagged issue")
        ContentReport.objects.create(reporter=other_citizen, issue=flagged, reason="spam")
        api.force_authenticate(admin_user)
        url = reverse("admin-issue-list")
        assert [i["id"] for i in api.get(url, {"moderation_status": "pending"}).data["results"]] == [str(pending.pk)]
        flagged_res = api.get(url, {"flagged": "true"}).data["results"]
        assert [(i["id"], i["report_count"]) for i in flagged_res] == [(str(flagged.pk), 1)]
        assert api.get(url, {"status": "reported"}).data["count"] == 2
        assert api.get(url, {"status": "bogus"}).status_code == 400
        assert api.get(url, {"moderation_status": "bogus"}).status_code == 400
        assert api.get(url, {"category": "x"}).status_code == 400


class TestApprove:
    def test_sets_moderation_and_status_in_one_action(self, api, admin_user, citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(admin_user)
        res = api.post(u("admin-approve", pending))
        assert res.status_code == 200, res.data
        assert (res.data["moderation_status"], res.data["status"]) == ("approved", "under_review")
        assert history(pending)[-1] == ("reported", "under_review")
        # now publicly visible
        api.force_authenticate(None)
        assert api.get(reverse("issue-detail", args=[pending.pk])).status_code == 200

    def test_cannot_approve_twice(self, api, admin_user, citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(admin_user)
        api.post(u("admin-approve", pending))
        assert api.post(u("admin-approve", pending)).status_code == 409
        assert len(history(pending)) == 2  # created + approved, no duplicate row

    def test_cannot_approve_an_already_approved_issue(self, api, admin_user, issue):
        api.force_authenticate(admin_user)
        assert api.post(u("admin-approve", issue)).status_code == 409

    def test_status_and_moderation_stay_consistent_when_status_blocks_it(self, api, admin_user, citizen, make_issue):
        odd = make_issue(citizen, approved=False, status="assigned")  # pending moderation but already assigned: bad data
        api.force_authenticate(admin_user)
        assert api.post(u("admin-approve", odd)).status_code == 409
        odd.refresh_from_db()
        assert odd.moderation_status == "pending"  # moderation not flipped without the status change

    def test_unknown_issue_404(self, api, admin_user):
        api.force_authenticate(admin_user)
        assert api.post(reverse("admin-approve", args=[uuid.uuid4()])).status_code == 404


class TestReject:
    def test_rejects_moderation_and_status_with_reason(self, api, admin_user, citizen, make_issue):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(admin_user)
        res = api.post(u("admin-reject", pending), {"reason": "Not a civic issue"}, format="json")
        assert res.status_code == 200, res.data
        assert (res.data["moderation_status"], res.data["status"]) == ("rejected", "rejected")
        last = IssueStatusHistory.objects.filter(issue=pending).latest("created_at")
        assert (last.old_status, last.new_status, last.reason) == ("reported", "rejected", "Not a civic issue")

    def test_rejected_issue_vanishes_from_public_but_owner_still_sees_it(self, api, admin_user, citizen, issue):
        api.force_authenticate(admin_user)
        api.post(u("admin-reject", issue), {"reason": "Spam"}, format="json")
        api.force_authenticate(None)
        assert api.get(reverse("issue-list")).data["count"] == 0
        assert api.get(reverse("issue-detail", args=[issue.pk])).status_code == 404
        api.force_authenticate(citizen)
        mine = api.get(reverse("issue-list"), {"mine": "true"}).data["results"][0]
        assert (mine["status"], mine["moderation_status"]) == ("rejected", "rejected")

    @pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}])
    def test_reason_required(self, api, admin_user, citizen, make_issue, body):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(admin_user)
        assert api.post(u("admin-reject", pending), body, format="json").status_code == 400
        pending.refresh_from_db()
        assert (pending.status, pending.moderation_status) == ("reported", "pending")

    def test_can_reject_an_approved_under_review_issue(self, api, admin_user, citizen, make_issue):
        approved = make_issue(citizen, status="under_review")
        api.force_authenticate(admin_user)
        assert api.post(u("admin-reject", approved), {"reason": "Duplicate of #12"}, format="json").status_code == 200

    @pytest.mark.parametrize("state", ["assigned", "in_progress", "resolved", "rejected"])
    def test_cannot_reject_once_work_started_or_already_rejected(self, api, admin_user, issue, state):
        Issue.objects.filter(pk=issue.pk).update(status=state)
        api.force_authenticate(admin_user)
        assert api.post(u("admin-reject", issue), {"reason": "no"}, format="json").status_code == 409
        issue.refresh_from_db()
        assert issue.status == state and issue.moderation_status == "approved"

    def test_rejecting_releases_a_stale_assignment(self, api, admin_user, officer_profile, issue, put_in_state):
        put_in_state(issue, "under_review", officer_profile, "accepted")  # left over from an earlier cycle
        api.force_authenticate(admin_user)
        api.post(u("admin-reject", issue), {"reason": "Invalid"}, format="json")
        assert IssueAssignment.objects.get(issue=issue).status == "superseded"
        api.force_authenticate(officer_profile.user)
        assert api.get(reverse("officer-issue-list")).data["count"] == 0


class TestAssign:
    def test_assign_creates_assignment_and_moves_to_assigned(self, api, admin_user, dept, officer_profile, issue):
        Issue.objects.filter(pk=issue.pk).update(status="under_review")
        api.force_authenticate(admin_user)
        res = api.post(u("admin-assign", issue), assign_body(dept, officer_profile), format="json")
        assert res.status_code == 201, res.data
        assert res.data["status"] == "assigned"
        assert res.data["assignment"]["status"] == "pending"
        assignment = IssueAssignment.objects.get(issue=issue)
        assert (assignment.department, assignment.officer, assignment.assigned_by) == (dept, officer_profile, admin_user)
        assert history(issue)[-1] == ("under_review", "assigned")
        # and it shows up in the officer's queue
        api.force_authenticate(officer_profile.user)
        assert api.get(reverse("officer-issue-list")).data["count"] == 1

    def test_officer_must_belong_to_department(self, api, admin_user, dept, other_officer, issue):
        Issue.objects.filter(pk=issue.pk).update(status="under_review")
        api.force_authenticate(admin_user)
        res = api.post(u("admin-assign", issue), assign_body(dept, other_officer), format="json")
        assert res.status_code == 400 and "officer" in res.data
        assert not IssueAssignment.objects.exists()

    def test_inactive_department_or_officer_rejected(self, api, admin_user, dept, officer_profile, issue):
        Issue.objects.filter(pk=issue.pk).update(status="under_review")
        api.force_authenticate(admin_user)
        Department.objects.filter(pk=dept.pk).update(is_active=False)
        assert api.post(u("admin-assign", issue), assign_body(dept, officer_profile), format="json").status_code == 400
        Department.objects.filter(pk=dept.pk).update(is_active=True)
        officer_profile.user.__class__.objects.filter(pk=officer_profile.user_id).update(is_active=False)
        assert api.post(u("admin-assign", issue), assign_body(dept, officer_profile), format="json").status_code == 400

    @pytest.mark.parametrize("state", ["reported", "assigned", "in_progress", "resolved", "rejected"])
    def test_only_from_under_review_or_reopened(self, api, admin_user, dept, officer_profile, issue, state):
        Issue.objects.filter(pk=issue.pk).update(status=state)
        api.force_authenticate(admin_user)
        assert api.post(u("admin-assign", issue), assign_body(dept, officer_profile), format="json").status_code == 409
        issue.refresh_from_db()
        assert issue.status == state
        assert not IssueAssignment.objects.exists()

    def test_bad_ids(self, api, admin_user, dept, officer_profile, issue):
        Issue.objects.filter(pk=issue.pk).update(status="under_review")
        api.force_authenticate(admin_user)
        url = u("admin-assign", issue)
        assert api.post(url, {}, format="json").status_code == 400
        assert api.post(url, {"department": str(uuid.uuid4()), "officer": str(officer_profile.pk)}, format="json").status_code == 400
        assert api.post(url, {"department": str(dept.pk), "officer": str(uuid.uuid4())}, format="json").status_code == 400

    def test_reassign_after_officer_rejection(self, api, admin_user, dept, officer_profile, colleague, assigned_issue):
        api.force_authenticate(officer_profile.user)
        api.post(u("officer-reject", assigned_issue), {"reason": "Wrong zone"}, format="json")
        api.force_authenticate(admin_user)
        res = api.post(u("admin-assign", assigned_issue), assign_body(dept, colleague), format="json")
        assert res.status_code == 201
        statuses = list(IssueAssignment.objects.filter(issue=assigned_issue).order_by("assigned_at").values_list("status", flat=True))
        assert statuses == ["rejected", "pending"]  # the rejection stays as history


class TestReopen:
    def test_reopen_requires_reason_and_resolved_state(self, api, admin_user, issue):
        Issue.objects.filter(pk=issue.pk).update(status="resolved")
        api.force_authenticate(admin_user)
        for body in ({}, {"reason": ""}, {"reason": "  "}):
            assert api.post(u("admin-reopen", issue), body, format="json").status_code == 400
        issue.refresh_from_db()
        assert issue.status == "resolved"
        res = api.post(u("admin-reopen", issue), {"reason": "Pothole is back"}, format="json")
        assert res.status_code == 200 and res.data["status"] == "reopened"
        last = IssueStatusHistory.objects.filter(issue=issue).latest("created_at")
        assert (last.old_status, last.new_status, last.reason) == ("resolved", "reopened", "Pothole is back")

    @pytest.mark.parametrize("state", ["reported", "under_review", "assigned", "in_progress", "reopened", "rejected"])
    def test_only_resolved_issues_can_be_reopened(self, api, admin_user, issue, state):
        Issue.objects.filter(pk=issue.pk).update(status=state)
        api.force_authenticate(admin_user)
        assert api.post(u("admin-reopen", issue), {"reason": "again"}, format="json").status_code == 409


class TestHideComment:
    def test_hide_is_idempotent_and_removes_it_from_public_view(self, api, admin_user, issue, citizen):
        comment = services.add_comment(issue=issue, user=citizen, content="rude")
        api.force_authenticate(admin_user)
        first = api.post(u("admin-hide-comment", comment))
        again = api.post(u("admin-hide-comment", comment))
        assert (first.status_code, first.data["is_hidden"], again.status_code) == (200, True, 200)
        api.force_authenticate(None)
        assert api.get(reverse("issue-comments", args=[issue.pk])).data["count"] == 0
        assert api.get(reverse("issue-detail", args=[issue.pk])).data["comment_count"] == 0

    def test_unknown_comment_404(self, api, admin_user):
        api.force_authenticate(admin_user)
        assert api.post(reverse("admin-hide-comment", args=[uuid.uuid4()])).status_code == 404


class TestDepartmentCrud:
    def test_full_crud(self, api, admin_user):
        api.force_authenticate(admin_user)
        created = api.post(
            reverse("admin-department-list"),
            {"name": "Street Lighting", "city": "Indore", "description": "Lamps"},
            format="json",
        )
        assert created.status_code == 201 and created.data["is_active"] is True and created.data["officers"] == []
        url = reverse("admin-department-detail", args=[created.data["id"]])
        assert api.get(url).data["name"] == "Street Lighting"
        patched = api.patch(url, {"description": "Lamps and poles", "is_active": False}, format="json")
        assert (patched.status_code, patched.data["is_active"]) == (200, False)
        assert api.get(reverse("admin-department-list")).data["count"] == 1
        assert api.delete(url).status_code == 204
        assert api.get(url).status_code == 404

    def test_lists_officers_so_admin_can_pick_one_to_assign(self, api, admin_user, dept, officer_profile):
        api.force_authenticate(admin_user)
        item = api.get(reverse("admin-department-list")).data["results"][0]
        assert item["officers"] == [
            {"id": str(officer_profile.pk), "name": officer_profile.user.full_name, "employee_reference": "EMP-001"}
        ]

    def test_duplicate_name_in_same_city_rejected_case_insensitively(self, api, admin_user, dept):
        api.force_authenticate(admin_user)
        res = api.post(reverse("admin-department-list"), {"name": "public works", "city": "INDORE"}, format="json")
        assert res.status_code == 400 and "name" in res.data
        ok = api.post(reverse("admin-department-list"), {"name": "Public Works", "city": "Bhopal"}, format="json")
        assert ok.status_code == 201

    def test_rename_into_a_duplicate_rejected_but_self_rename_ok(self, api, admin_user, dept, other_dept):
        api.force_authenticate(admin_user)
        url = reverse("admin-department-detail", args=[other_dept.pk])
        assert api.patch(url, {"name": "Public Works"}, format="json").status_code == 400
        assert api.patch(url, {"name": "Sanitation", "description": "same name, new text"}, format="json").status_code == 200

    def test_name_required(self, api, admin_user):
        api.force_authenticate(admin_user)
        assert api.post(reverse("admin-department-list"), {"city": "Indore"}, format="json").status_code == 400

    def test_cannot_delete_department_in_use(self, api, admin_user, dept, officer_profile):
        api.force_authenticate(admin_user)
        res = api.delete(reverse("admin-department-detail", args=[dept.pk]))
        assert res.status_code == 409
        assert Department.objects.filter(pk=dept.pk).exists()
