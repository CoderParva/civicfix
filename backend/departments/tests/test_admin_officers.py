import pytest
from django.db import IntegrityError
from django.urls import reverse

from accounts.models import User
from conftest import PASSWORD
from departments import services
from departments.models import Department, OfficerProfile
from issues.models import Issue

pytestmark = pytest.mark.django_db

URL = "admin-officer-create"


def payload(dept, **over):
    data = {
        "email": "new.officer@example.com",
        "full_name": "New Officer",
        "password": PASSWORD,
        "department": str(dept.pk),
        "employee_reference": "PW-100",
    }
    data.update(over)
    return data


def post(api, data):
    return api.post(reverse(URL), data, format="json")


class TestAccessControl:
    def test_anonymous_401(self, api, dept):
        assert post(api, payload(dept)).status_code == 401

    @pytest.mark.parametrize("who", ["citizen", "officer"])
    def test_citizen_and_officer_403_and_nothing_created(self, api, dept, who, request):
        api.force_authenticate(request.getfixturevalue(who))
        before = User.objects.count()
        assert post(api, payload(dept)).status_code == 403
        assert User.objects.count() == before
        assert not OfficerProfile.objects.exists()

    def test_get_not_allowed(self, api, admin_user):
        api.force_authenticate(admin_user)
        assert api.get(reverse(URL)).status_code == 405


class TestHappyPath:
    def test_creates_user_and_profile(self, api, admin_user, dept):
        api.force_authenticate(admin_user)
        res = post(api, payload(dept))
        assert res.status_code == 201, res.data
        assert set(res.data) == {"id", "name", "employee_reference", "department"}
        assert res.data["name"] == "New Officer" and res.data["employee_reference"] == "PW-100"
        assert res.data["department"] == {"id": str(dept.pk), "name": "Public Works", "city": "Indore", "is_active": True}
        assert "password" not in str(res.data)

        user = User.objects.get(email="new.officer@example.com")
        assert user.role == User.Role.OFFICER and user.is_active
        assert not user.is_staff and not user.is_superuser
        assert user.check_password(PASSWORD) and user.password != PASSWORD
        profile = OfficerProfile.objects.get(user=user)
        assert (profile.department, str(profile.pk)) == (dept, res.data["id"])

    def test_email_is_normalised(self, api, admin_user, dept):
        api.force_authenticate(admin_user)
        post(api, payload(dept, email="Mixed.Case@Example.COM"))
        assert User.objects.filter(email="mixed.case@example.com").exists()

    def test_role_and_privileges_cannot_be_injected(self, api, admin_user, dept):
        api.force_authenticate(admin_user)
        res = post(api, payload(dept, role="admin", is_staff=True, is_superuser=True))
        assert res.status_code == 201
        user = User.objects.get(email="new.officer@example.com")
        assert user.role == "officer" and not user.is_staff and not user.is_superuser

    def test_new_officer_can_log_in_immediately(self, api, admin_user, dept):
        api.force_authenticate(admin_user)
        post(api, payload(dept))
        api.force_authenticate(None)
        res = api.post(reverse("auth-login"), {"email": "new.officer@example.com", "password": PASSWORD}, format="json")
        assert res.status_code == 200 and res.data["user"]["role"] == "officer"

    def test_new_officer_is_immediately_usable_in_the_assign_api(self, api, admin_user, dept, issue):
        """create officer -> assign an issue to them -> they see and can accept it. No shell, no admin site."""
        Issue.objects.filter(pk=issue.pk).update(status="under_review")
        api.force_authenticate(admin_user)
        created = post(api, payload(dept))
        assert created.status_code == 201

        # the id from the response is the one assign wants, and it also appears under the department
        listed = api.get(reverse("admin-department-detail", args=[dept.pk])).data["officers"]
        assert [o["id"] for o in listed] == [created.data["id"]]

        res = api.post(
            reverse("admin-assign", args=[issue.pk]),
            {"department": str(dept.pk), "officer": created.data["id"]},
            format="json",
        )
        assert res.status_code == 201, res.data
        assert res.data["assignment"]["officer"]["id"] == created.data["id"]

        api.force_authenticate(None)
        login = api.post(reverse("auth-login"), {"email": "new.officer@example.com", "password": PASSWORD}, format="json")
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        queue = api.get(reverse("officer-issue-list"))
        assert [i["id"] for i in queue.data["results"]] == [str(issue.pk)]
        assert api.post(reverse("officer-accept", args=[issue.pk])).data["status"] == "in_progress"


class TestValidation:
    def test_duplicate_email_rejected_case_insensitively(self, api, admin_user, dept, citizen):
        api.force_authenticate(admin_user)
        for email in (citizen.email, citizen.email.upper()):
            res = post(api, payload(dept, email=email))
            assert res.status_code == 400 and "email" in res.data
        assert not OfficerProfile.objects.exists()

    def test_duplicate_employee_reference_rejected_and_no_user_left_behind(self, api, admin_user, dept, officer_profile):
        api.force_authenticate(admin_user)
        users_before = User.objects.count()
        for ref in ("EMP-001", "emp-001"):  # exact and case-variant
            res = post(api, payload(dept, employee_reference=ref))
            assert res.status_code == 400 and "employee_reference" in res.data
        assert User.objects.count() == users_before

    @pytest.mark.parametrize(
        "password",
        ["Sh0rt!x", "password", "12345678901", "new.officer@example.com"],
        ids=["too-short", "common", "all-numeric", "same-as-email"],
    )
    def test_weak_passwords_rejected_with_same_rules_as_registration(self, api, admin_user, dept, password):
        api.force_authenticate(admin_user)
        res = post(api, payload(dept, password=password))
        assert res.status_code == 400 and "password" in res.data
        assert not User.objects.filter(email="new.officer@example.com").exists()

    def test_error_messages_match_public_registration(self, api, admin_user, dept):
        """Same code path, so same messages -- guards against the two validators drifting apart."""
        api.force_authenticate(admin_user)
        officer_err = post(api, payload(dept, password="password")).data["password"]
        api.force_authenticate(None)
        register_err = api.post(
            reverse("auth-register"), {"email": "x@example.com", "full_name": "X", "password": "password"}, format="json"
        ).data["password"]
        assert officer_err == register_err

    def test_inactive_department_rejected(self, api, admin_user, dept):
        Department.objects.filter(pk=dept.pk).update(is_active=False)
        api.force_authenticate(admin_user)
        res = post(api, payload(dept))
        assert res.status_code == 400 and "department" in res.data
        assert not User.objects.filter(email="new.officer@example.com").exists()

    def test_unknown_or_malformed_department_rejected(self, api, admin_user, dept):
        import uuid

        api.force_authenticate(admin_user)
        for value in (str(uuid.uuid4()), "not-a-uuid", None):
            res = post(api, payload(dept, department=value))
            assert res.status_code == 400 and "department" in res.data

    @pytest.mark.parametrize("field", ["email", "full_name", "password", "department", "employee_reference"])
    def test_every_field_required(self, api, admin_user, dept, field):
        api.force_authenticate(admin_user)
        data = payload(dept)
        data.pop(field)
        res = post(api, data)
        assert res.status_code == 400 and field in res.data

    @pytest.mark.parametrize("override", [{"email": "nope"}, {"employee_reference": "  "}, {"employee_reference": "x" * 51}])
    def test_malformed_values(self, api, admin_user, dept, override):
        api.force_authenticate(admin_user)
        assert post(api, payload(dept, **override)).status_code == 400


class TestAtomicity:
    def test_profile_failure_leaves_no_orphan_user(self, dept, monkeypatch):
        def boom(*args, **kwargs):
            raise IntegrityError("simulated: profile insert failed")

        monkeypatch.setattr(OfficerProfile.objects, "create", boom)
        with pytest.raises(Exception):
            services.create_officer(
                email="orphan@example.com", full_name="Orphan", password=PASSWORD, department=dept, employee_reference="X-1"
            )
        assert not User.objects.filter(email="orphan@example.com").exists()

    def test_race_on_employee_reference_becomes_400_not_500(self, api, admin_user, dept, officer_profile, monkeypatch):
        """Pre-check passes (we stub it), the DB unique constraint then fires: still a clean 400."""
        from departments.serializers import OfficerCreateSerializer

        monkeypatch.setattr(OfficerCreateSerializer, "validate_employee_reference", lambda self, v: v)
        api.force_authenticate(admin_user)
        res = post(api, payload(dept, employee_reference="EMP-001"))
        assert res.status_code == 400
        assert not User.objects.filter(email="new.officer@example.com").exists()
