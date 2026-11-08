"""ensure_postgis and lockdown_public_schema, against the real PostgreSQL/PostGIS test database."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connection

pytestmark = pytest.mark.django_db(transaction=True)


def run(name):
    out = StringIO()
    call_command(name, stdout=out)
    return out.getvalue()


def test_ensure_postgis_reports_the_version():
    assert "PostGIS is available" in run("ensure_postgis")


def test_ensure_postgis_is_idempotent():
    run("ensure_postgis")
    assert "PostGIS is available" in run("ensure_postgis")


def rls_off():
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity"
        )
        return [row[0] for row in cursor.fetchall()]


def test_lockdown_enables_row_level_security_on_every_public_table():
    with connection.cursor() as cursor:
        cursor.execute("ALTER TABLE public.accounts_user DISABLE ROW LEVEL SECURITY")
    assert "accounts_user" in rls_off()
    output = run("lockdown_public_schema")
    assert rls_off() == []
    assert "No public table is left without row-level security." in output


def test_lockdown_is_idempotent():
    run("lockdown_public_schema")
    assert "No public table is left" in run("lockdown_public_schema")


def test_supabase_api_roles_cannot_read_anything_after_lockdown_but_the_owner_still_can():
    """Simulate Supabase's `anon` role (the public API key): it must see nothing; Django (the owner) is unaffected."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = 'anon'")
        existed = cursor.fetchone() is not None
        if not existed:
            cursor.execute("CREATE ROLE anon NOLOGIN")
        try:
            cursor.execute("GRANT USAGE ON SCHEMA public TO anon")
            cursor.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon")  # what Supabase's defaults do
            cursor.execute("SET ROLE anon")
            cursor.execute("SELECT count(*) FROM accounts_user")  # readable before lockdown
            cursor.execute("RESET ROLE")

            run("lockdown_public_schema")

            cursor.execute("SET ROLE anon")
            with pytest.raises(Exception, match="permission denied"):
                cursor.execute("SELECT count(*) FROM accounts_user")
        finally:
            connection.rollback() if not connection.get_autocommit() else None
            cursor.execute("RESET ROLE")
            if not existed:
                cursor.execute("DROP OWNED BY anon")
                cursor.execute("DROP ROLE anon")
    # the application itself (the table owner) still works
    from accounts.models import User

    assert User.objects.count() >= 0
