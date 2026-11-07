import pytest
from django.urls import reverse
from rest_framework_simplejwt.tokens import AccessToken

from accounts.models import User
from conftest import PASSWORD

pytestmark = pytest.mark.django_db

REGISTER = "auth-register"
LOGIN = "auth-login"
REFRESH = "auth-token-refresh"
PROFILE = "auth-profile"


def register_payload(**over):
    data = {"email": "new@example.com", "full_name": "New Citizen", "password": PASSWORD}
    data.update(over)
    return data


class TestRegister:
    def test_register_creates_citizen(self, api):
        res = api.post(reverse(REGISTER), register_payload(city="Indore", state="MP"), format="json")
        assert res.status_code == 201
        assert res.data["email"] == "new@example.com"
        assert res.data["role"] == "citizen"
        assert "password" not in res.data
        user = User.objects.get(email="new@example.com")
        assert user.check_password(PASSWORD)
        assert user.password != PASSWORD

    def test_register_cannot_self_assign_role(self, api):
        res = api.post(reverse(REGISTER), register_payload(role="admin", is_staff=True, is_superuser=True), format="json")
        assert res.status_code == 201
        user = User.objects.get(email="new@example.com")
        assert user.role == User.Role.CITIZEN
        assert not user.is_staff and not user.is_superuser

    def test_email_is_normalised_to_lowercase(self, api):
        api.post(reverse(REGISTER), register_payload(email="Mixed@Example.COM"), format="json")
        assert User.objects.filter(email="mixed@example.com").exists()

    def test_duplicate_email_rejected(self, api, citizen):
        res = api.post(reverse(REGISTER), register_payload(email=citizen.email), format="json")
        assert res.status_code == 400
        assert "email" in res.data

    def test_duplicate_email_rejected_case_insensitively(self, api, citizen):
        res = api.post(reverse(REGISTER), register_payload(email=citizen.email.upper()), format="json")
        assert res.status_code == 400
        assert "email" in res.data
        assert User.objects.count() == 1

    @pytest.mark.parametrize(
        "password",
        ["Sh0rt!x", "password", "12345678901", "new@example.com"],
        ids=["too-short", "common", "all-numeric", "similar-to-email"],
    )
    def test_weak_passwords_rejected(self, api, password):
        res = api.post(reverse(REGISTER), register_payload(password=password), format="json")
        assert res.status_code == 400
        assert "password" in res.data
        assert not User.objects.exists()

    def test_missing_fields_rejected(self, api):
        res = api.post(reverse(REGISTER), {}, format="json")
        assert res.status_code == 400
        assert {"email", "full_name", "password"} <= set(res.data)

    def test_invalid_email_rejected(self, api):
        res = api.post(reverse(REGISTER), register_payload(email="not-an-email"), format="json")
        assert res.status_code == 400
        assert "email" in res.data


class TestLogin:
    def test_login_returns_tokens_with_role_claim(self, api, officer):
        res = api.post(reverse(LOGIN), {"email": officer.email, "password": PASSWORD}, format="json")
        assert res.status_code == 200
        assert {"access", "refresh", "user"} <= set(res.data)
        assert res.data["user"]["role"] == "officer"
        claims = AccessToken(res.data["access"])
        assert claims["role"] == "officer"
        assert claims["user_id"] == str(officer.id)

    def test_login_email_is_case_insensitive(self, api, citizen):
        res = api.post(reverse(LOGIN), {"email": citizen.email.upper(), "password": PASSWORD}, format="json")
        assert res.status_code == 200

    def test_wrong_password_rejected(self, api, citizen):
        res = api.post(reverse(LOGIN), {"email": citizen.email, "password": "wrong"}, format="json")
        assert res.status_code == 401

    def test_unknown_user_rejected(self, api):
        res = api.post(reverse(LOGIN), {"email": "nobody@example.com", "password": PASSWORD}, format="json")
        assert res.status_code == 401

    def test_inactive_user_rejected(self, api, citizen):
        citizen.is_active = False
        citizen.save()
        res = api.post(reverse(LOGIN), {"email": citizen.email, "password": PASSWORD}, format="json")
        assert res.status_code == 401


class TestTokenRefresh:
    def login(self, api, user):
        return api.post(reverse(LOGIN), {"email": user.email, "password": PASSWORD}, format="json").data

    def test_refresh_returns_new_access_and_rotated_refresh(self, api, citizen):
        tokens = self.login(api, citizen)
        res = api.post(reverse(REFRESH), {"refresh": tokens["refresh"]}, format="json")
        assert res.status_code == 200
        assert res.data["access"]
        assert res.data["refresh"] != tokens["refresh"]

    def test_old_refresh_token_is_blacklisted_after_rotation(self, api, citizen):
        tokens = self.login(api, citizen)
        assert api.post(reverse(REFRESH), {"refresh": tokens["refresh"]}, format="json").status_code == 200
        replay = api.post(reverse(REFRESH), {"refresh": tokens["refresh"]}, format="json")
        assert replay.status_code == 401

    def test_new_refresh_token_works(self, api, citizen):
        tokens = self.login(api, citizen)
        rotated = api.post(reverse(REFRESH), {"refresh": tokens["refresh"]}, format="json").data
        assert api.post(reverse(REFRESH), {"refresh": rotated["refresh"]}, format="json").status_code == 200

    def test_garbage_refresh_rejected(self, api):
        assert api.post(reverse(REFRESH), {"refresh": "garbage"}, format="json").status_code == 401

    def test_access_token_is_not_a_refresh_token(self, api, citizen):
        tokens = self.login(api, citizen)
        assert api.post(reverse(REFRESH), {"refresh": tokens["access"]}, format="json").status_code == 401


class TestProfile:
    def test_requires_authentication(self, api):
        assert api.get(reverse(PROFILE)).status_code == 401

    def test_get_profile_with_bearer_token(self, api, citizen):
        access = api.post(reverse(LOGIN), {"email": citizen.email, "password": PASSWORD}, format="json").data["access"]
        res = api.get(reverse(PROFILE), HTTP_AUTHORIZATION=f"Bearer {access}")
        assert res.status_code == 200
        assert res.data["email"] == citizen.email

    def test_patch_updates_allowed_fields(self, api, citizen):
        api.force_authenticate(citizen)
        res = api.patch(reverse(PROFILE), {"full_name": "Renamed", "city": "Indore", "phone_number": "9999999999"}, format="json")
        assert res.status_code == 200
        citizen.refresh_from_db()
        assert (citizen.full_name, citizen.city, citizen.phone_number) == ("Renamed", "Indore", "9999999999")

    def test_patch_cannot_escalate_role_or_change_email(self, api, citizen):
        api.force_authenticate(citizen)
        res = api.patch(
            reverse(PROFILE),
            {"role": "admin", "email": "other@example.com", "is_staff": True, "full_name": "Still Me"},
            format="json",
        )
        assert res.status_code == 200
        citizen.refresh_from_db()
        assert citizen.role == User.Role.CITIZEN
        assert citizen.email == "citizen@example.com"
        assert not citizen.is_staff
        assert citizen.full_name == "Still Me"

    def test_put_not_allowed(self, api, citizen):
        api.force_authenticate(citizen)
        assert api.put(reverse(PROFILE), {"full_name": "x"}, format="json").status_code == 405
