"""Copy issue photos that exist only on the local disk (MEDIA_ROOT) into the configured object storage.

For when a database that already has photo rows is pointed at Supabase Storage: each row keeps its file name,
the storage URL is derived from it, and the file simply is not in the bucket yet. (A fresh database seeded
with `seed_demo` needs none of this: it uploads straight to the bucket.)

    python manage.py sync_media_to_storage --dry-run     # report only
    python manage.py sync_media_to_storage               # copy what is missing

Safe to run any number of times: files already in storage are left alone, nothing is deleted anywhere.
"""
from django.conf import settings
from django.core.files.storage import FileSystemStorage, default_storage
from django.core.management.base import BaseCommand

from issues.models import IssueImage


class Command(BaseCommand):
    help = "Copy local-disk issue photos that are missing from the configured object storage."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="only report what would be copied")

    def handle(self, *args, dry_run, **options):
        if isinstance(default_storage, FileSystemStorage):  # (LazyObject proxies __class__, so this sees the real backend)
            self.stdout.write("The default storage is the local disk already: nothing to copy.")
            return

        local = FileSystemStorage(location=settings.MEDIA_ROOT)
        copied = present = missing = 0
        # order_by() matters: the model's default ordering would otherwise defeat distinct() and count rows, not files
        # (seeded issues share a handful of photos).
        names = IssueImage.objects.exclude(image="").order_by("image").values_list("image", flat=True).distinct()
        for name in names:
            if default_storage.exists(name):
                present += 1
            elif not local.exists(name):
                missing += 1
                self.stdout.write(self.style.WARNING(f"  not on local disk either: {name}"))
            else:
                if not dry_run:
                    with local.open(name, "rb") as handle:
                        saved = default_storage.save(name, handle)
                    assert saved == name, f"storage renamed {name!r} to {saved!r}; refusing to leave a dangling row"
                copied += 1
                self.stdout.write(f"  {'would copy' if dry_run else 'copied'}: {name}")

        verb = "would be copied" if dry_run else "copied"
        self.stdout.write(self.style.SUCCESS(f"{copied} {verb}, {present} already in storage, {missing} not found anywhere."))
