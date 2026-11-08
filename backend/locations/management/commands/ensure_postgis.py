"""Make sure PostGIS is available, and print its version.

Runs at every production boot (scripts/start.sh) before `migrate`, and is the quickest way to verify a
brand-new database (Supabase's free tier does not guarantee PostGIS is pre-enabled).

    python manage.py ensure_postgis
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection


class Command(BaseCommand):
    help = "Verify PostGIS is installed in the configured database (installing it if allowed) and print its version."

    def handle(self, *args, **options):
        if connection.vendor != "postgresql":
            raise CommandError(f"The database is {connection.vendor}, not PostgreSQL: PostGIS is not available.")

        version = self._version()
        if version is None:
            self.stdout.write("PostGIS is not enabled yet; creating the extension...")
            try:
                with connection.cursor() as cursor:
                    # Supabase keeps extensions in their own schema (which is on the default search_path).
                    cursor.execute("SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'")
                    schema = "extensions" if cursor.fetchone() else "public"
                    cursor.execute(f"CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA {schema}")
            except DatabaseError as error:
                raise CommandError(
                    f"Could not enable PostGIS ({error}). Enable it in the Supabase dashboard "
                    "(Database > Extensions > postgis) or run: CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;"
                ) from error
            version = self._version()
        if version is None:
            raise CommandError("PostGIS still is not usable after CREATE EXTENSION.")
        self.stdout.write(self.style.SUCCESS(f"PostGIS is available: {version}"))

    @staticmethod
    def _version():
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT PostGIS_Full_Version()")
                return cursor.fetchone()[0].split(" GEOS")[0]  # "POSTGIS="3.4.2 ..." is long; the head is enough
        except DatabaseError:
            return None
