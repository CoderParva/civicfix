import uuid

import pytest
from django.db import IntegrityError, transaction

from accounts.models import User

pytestmark = pytest.mark.django_db


def test_user_pk_is_uuid():
    user = User.objects.create_user("a@example.com", "pw-Str0ng!x", full_name="A")
    assert isinstance(user.id, uuid.UUID)


def test_create_user_defaults_to_citizen_non_staff():
    user = User.objects.create_user("a@example.com", "pw-Str0ng!x", full_name="A")
    assert user.role == User.Role.CITIZEN
    assert not user.is_staff and not user.is_superuser


def test_create_superuser_is_admin_role():
    user = User.objects.create_superuser("root@example.com", "pw-Str0ng!x", full_name="Root")
    assert user.role == User.Role.ADMIN
    assert user.is_staff and user.is_superuser


def test_db_enforces_case_insensitive_email_uniqueness():
    User.objects.create_user("dup@example.com", "pw-Str0ng!x", full_name="A")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create(email="DUP@example.com", full_name="B")
