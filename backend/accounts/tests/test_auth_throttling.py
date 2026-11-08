"""Login, registration and refresh are rate limited per client IP (they were the only unthrottled endpoints)."""
import pytest
from django.urls import reverse
from rest_framework.throttling import SimpleRateThrottle

from conftest import PASSWORD

pytestmark = pytest.mark.django_db


@pytest.fixture
def tight(monkeypatch):
    for scope in ("auth_login", "auth_register", "auth_refresh"):
        monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, scope, "3/hour")


def test_configured_rates_exist():
    for scope in ("auth_login", "auth_register", "auth_refresh"):
        assert scope in SimpleRateThrottle.THROTTLE_RATES


def test_password_guessing_is_cut_off(api, citizen, tight):
    codes = [api.post(reverse("auth-login"), {"email": citizen.email, "password": "wrong"}, format="json").status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]
    # and the lock-out applies to the right password too, for as long as the window lasts
    assert api.post(reverse("auth-login"), {"email": citizen.email, "password": PASSWORD}, format="json").status_code == 429


def test_registration_spam_is_cut_off(api, tight):
    def register(n):
        return api.post(reverse("auth-register"), {"email": f"new{n}@example.com", "password": "Str0ng-Passw0rd!x", "full_name": "New Person"}, format="json").status_code

    assert [register(n) for n in range(4)] == [201, 201, 201, 429]


def test_refresh_is_limited_too(api, tight):
    codes = [api.post(reverse("auth-token-refresh"), {"refresh": "not-a-token"}, format="json").status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]


def test_the_limit_is_per_client_ip_so_one_attacker_does_not_lock_out_everyone(api, citizen, tight):
    for _ in range(4):
        api.post(reverse("auth-login"), {"email": citizen.email, "password": "wrong"}, format="json", REMOTE_ADDR="198.51.100.7")
    other = api.post(reverse("auth-login"), {"email": citizen.email, "password": PASSWORD}, format="json", REMOTE_ADDR="203.0.113.9")
    assert other.status_code == 200


def test_normal_use_is_nowhere_near_the_default_limits(api, citizen):
    for _ in range(5):  # a few logins in a minute is ordinary (several tabs, a retry after a typo)
        assert api.post(reverse("auth-login"), {"email": citizen.email, "password": PASSWORD}, format="json").status_code == 200
