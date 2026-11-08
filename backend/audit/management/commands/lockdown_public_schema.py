"""Turn on row-level security for every table in the `public` schema (idempotent).

Why: on Supabase, anything in `public` is also reachable through Supabase's auto-generated REST API with the
project's public "anon" key. Django's tables (including accounts_user with password hashes) would be readable
by anyone who has that key. With RLS enabled and no policies, that API sees nothing, while Django is unaffected:
it connects as the table owner, which bypasses RLS. We also revoke the API roles' table privileges.

On plain PostgreSQL (local development) the API roles do not exist; RLS is still enabled, harmlessly.

    python manage.py lockdown_public_schema
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection

API_ROLES = ("anon", "authenticated")


class Command(BaseCommand):
    help = "Enable row-level security on all public tables and revoke Supabase API roles' privileges."

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            raise CommandError("Only PostgreSQL databases are supported.")

        with connection.cursor() as cursor:
            cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
            tables = [row[0] for row in cursor.fetchall()]
            skipped = []
            for table in tables:
                try:
                    cursor.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
                except DatabaseError as error:  # e.g. an extension-owned table we do not own
                    skipped.append((table, str(error).splitlines()[0]))

            cursor.execute("SELECT rolname FROM pg_roles WHERE rolname = ANY(%s)", [list(API_ROLES)])
            roles = [row[0] for row in cursor.fetchall()]
            for role in roles:
                cursor.execute(f'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "{role}"')
                cursor.execute(f'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "{role}"')
                cursor.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "{role}"')

            cursor.execute(
                "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY c.relname"
            )
            unprotected = [row[0] for row in cursor.fetchall()]

        self.stdout.write(f"Row-level security enabled on {len(tables) - len(skipped)} of {len(tables)} public tables.")
        if roles:
            self.stdout.write(f"Revoked privileges from API roles: {', '.join(roles)}.")
        for table, reason in skipped:
            self.stdout.write(self.style.WARNING(f"  could not change {table}: {reason}"))
        if unprotected:
            self.stdout.write(self.style.WARNING(f"Still without RLS: {', '.join(unprotected)}"))
        else:
            self.stdout.write(self.style.SUCCESS("No public table is left without row-level security."))
