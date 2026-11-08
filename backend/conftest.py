import pytest
from rest_framework.test import APIClient

from accounts.models import User

PASSWORD = "Str0ng-Passw0rd!x"


@pytest.fixture(autouse=True)
def _isolate_cache_and_media(settings, tmp_path):
    """Throttle counters live in the cache and uploads go to MEDIA_ROOT: keep both per-test."""
    from django.core.cache import cache

    cache.clear()
    settings.MEDIA_ROOT = tmp_path / "media"
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _ai_off_by_default(settings):
    """No test loads a real model by accident. AI tests opt in with the `ai_local` fixture (ai_engine/tests)."""
    from ai_engine import backends

    settings.AI_INFERENCE = "disabled"
    backends.reset_backends()
    yield
    backends.reset_backends()


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def make_user(db):
    def _make(email="citizen@example.com", role=User.Role.CITIZEN, **extra):
        user = User.objects.create_user(email=email, password=PASSWORD, full_name="Test User", **extra)
        if role != User.Role.CITIZEN:
            user.role = role
            user.save(update_fields=["role"])
        return user

    return _make


@pytest.fixture
def citizen(make_user):
    return make_user("citizen@example.com", User.Role.CITIZEN)


@pytest.fixture
def officer(make_user):
    return make_user("officer@example.com", User.Role.OFFICER)


@pytest.fixture
def admin_user(make_user):
    return make_user("admin@example.com", User.Role.ADMIN)
