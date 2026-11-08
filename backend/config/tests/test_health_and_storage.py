"""Health endpoint, and issue photos going to S3-compatible storage (a fake S3 via moto, same options as production)."""
import re

import boto3
import pytest
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage, storages
from django.db import connection
from django.urls import reverse
from moto import mock_aws

from config.storage import IMMUTABLE_CACHE, s3_storage_options
from issues.models import Issue, IssueImage
from issues.tests.conftest import category, issue, issue_payload, make_image_file, make_issue, other_citizen, png  # noqa: F401

BUCKET = "issue-photos"
PUBLIC_BASE = "https://abcd.supabase.co/storage/v1/object/public/issue-photos"


class TestHealth:
    def test_is_public_and_cheap(self, api):
        res = api.get(reverse("health"))
        assert res.status_code == 200 and res.json() == {"status": "ok"}

    @pytest.mark.django_db
    def test_with_db_flag_it_round_trips_the_database(self, api):
        res = api.get(reverse("health"), {"db": "1"})
        assert res.status_code == 200 and res.json() == {"status": "ok", "database": "ok"}

    @pytest.mark.django_db
    def test_reports_503_when_the_database_is_down(self, api, monkeypatch):
        def boom(*args, **kwargs):
            raise RuntimeError("db down")

        monkeypatch.setattr(connection, "cursor", boom)
        res = api.get(reverse("health"), {"db": "1"})
        assert res.status_code == 503 and res.json() == {"status": "error", "database": "unreachable"}

    def test_only_get(self, api):
        assert api.post(reverse("health")).status_code == 405


@pytest.fixture
def s3(settings):
    """Photos stored in a (fake) S3 bucket through the exact storage options production uses."""
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket=BUCKET)
        settings.STORAGES = {
            **settings.STORAGES,
            "default": {
                "BACKEND": "storages.backends.s3.S3Storage",
                "OPTIONS": s3_storage_options(
                    endpoint_url="https://s3.us-east-1.amazonaws.com",
                    region="us-east-1",
                    access_key="testing",
                    secret_key="testing",
                    bucket=BUCKET,
                    public_base_url=PUBLIC_BASE,
                ),
            },
        }
        storages._storages.clear() if hasattr(storages, "_storages") else None
        yield boto3.client("s3", region_name="us-east-1")


class TestObjectStorage:
    def test_saved_files_land_in_the_bucket_and_get_the_public_url(self, s3):
        name = default_storage.save("issues/abc/photo.png", ContentFile(b"png-bytes"))
        assert default_storage.url(name) == f"{PUBLIC_BASE}/issues/abc/photo.png"
        head = s3.head_object(Bucket=BUCKET, Key=name)
        assert head["CacheControl"] == IMMUTABLE_CACHE
        assert s3.get_object(Bucket=BUCKET, Key=name)["Body"].read() == b"png-bytes"

    def test_a_name_clash_never_overwrites_an_existing_photo(self, s3):
        first = default_storage.save("issues/abc/photo.png", ContentFile(b"one"))
        second = default_storage.save("issues/abc/photo.png", ContentFile(b"two"))
        assert first != second
        assert s3.get_object(Bucket=BUCKET, Key=first)["Body"].read() == b"one"

    @pytest.mark.django_db
    def test_an_uploaded_issue_photo_goes_through_the_api_to_the_bucket(self, api, citizen, issue, png, s3):
        api.force_authenticate(citizen)
        res = api.post(reverse("issue-images", args=[issue.pk]), {"image": png}, format="multipart")
        assert res.status_code == 201, res.data
        url = res.data["url"] if "url" in res.data else res.data["image_url"]
        assert re.fullmatch(rf"{re.escape(PUBLIC_BASE)}/issues/{issue.pk}/[0-9a-f]{{32}}\.png", url), url
        key = IssueImage.objects.get(issue=issue).image.name
        stored = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
        assert stored.startswith(b"\x89PNG"), "the sanitised re-encoded image is what is stored"

    @pytest.mark.django_db
    def test_the_photo_is_readable_from_the_issue_detail_response(self, api, citizen, issue, png, s3):
        api.force_authenticate(citizen)
        api.post(reverse("issue-images", args=[issue.pk]), {"image": png}, format="multipart")
        detail = api.get(reverse("issue-detail", args=[issue.pk])).data
        assert detail["images"][0]["url"].startswith(PUBLIC_BASE + "/")


def test_issue_model_default_storage_is_local_disk_in_development():
    # Dev keeps photos on local disk: nothing here may require network or credentials.
    assert default_storage.__class__.__name__ == "FileSystemStorage"
    assert Issue  # imported for the fixtures above


class TestSyncMediaToStorage:
    """sync_media_to_storage copies photos that exist only on local disk into the bucket."""

    @pytest.fixture
    def local_photos(self, settings, tmp_path):
        settings.MEDIA_ROOT = tmp_path / "media"
        (settings.MEDIA_ROOT / "issues" / "a").mkdir(parents=True)
        (settings.MEDIA_ROOT / "issues" / "a" / "one.png").write_bytes(b"one")
        (settings.MEDIA_ROOT / "issues" / "a" / "two.png").write_bytes(b"two")
        return settings.MEDIA_ROOT

    @pytest.fixture
    def rows(self, issue, other_citizen):
        """Three rows over two files (seeded issues share photos), plus one row whose file is nowhere."""
        for name in ("issues/a/one.png", "issues/a/one.png", "issues/a/two.png", "issues/a/ghost.png"):
            IssueImage.objects.create(issue=issue, image=name)

    def run(self, *flags):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command("sync_media_to_storage", *flags, stdout=out)
        return out.getvalue()

    @pytest.mark.django_db
    def test_copies_each_missing_file_once_and_reports_the_rest(self, s3, local_photos, rows):
        text = self.run()
        assert "2 copied, 0 already in storage, 1 not found anywhere." in text
        assert s3.get_object(Bucket=BUCKET, Key="issues/a/one.png")["Body"].read() == b"one"
        assert s3.get_object(Bucket=BUCKET, Key="issues/a/two.png")["Body"].read() == b"two"
        assert "ghost.png" in text

    @pytest.mark.django_db
    def test_is_idempotent_and_never_overwrites(self, s3, local_photos, rows):
        self.run()
        s3.put_object(Bucket=BUCKET, Key="issues/a/one.png", Body=b"changed-in-storage")
        assert "0 copied, 2 already in storage" in self.run()
        assert s3.get_object(Bucket=BUCKET, Key="issues/a/one.png")["Body"].read() == b"changed-in-storage"

    @pytest.mark.django_db
    def test_dry_run_changes_nothing(self, s3, local_photos, rows):
        assert "2 would be copied" in self.run("--dry-run")
        assert "Contents" not in s3.list_objects_v2(Bucket=BUCKET)

    @pytest.mark.django_db
    def test_with_the_local_disk_as_default_storage_there_is_nothing_to_do(self, local_photos, rows):
        assert "already: nothing to copy" in self.run()
