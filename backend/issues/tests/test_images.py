from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from issues import images
from issues.models import Issue, IssueImage
from issues.tests.conftest import make_image_file

pytestmark = pytest.mark.django_db


def url(issue):
    return reverse("issue-images", args=[issue.pk])


def upload(api, issue, file):
    return api.post(url(issue), {"image": file}, format="multipart")


class TestUpload:
    def test_owner_uploads_png(self, api, citizen, issue, png):
        api.force_authenticate(citizen)
        res = upload(api, issue, png)
        assert res.status_code == 201, res.data
        assert res.data["image_type"] == "report"
        assert res.data["url"].startswith("http")
        stored = IssueImage.objects.get(issue=issue)
        assert stored.image.name.endswith(".png")
        assert stored.image.name.startswith(f"issues/{issue.pk}/")

    @pytest.mark.parametrize("fmt,ext", [("JPEG", "jpg"), ("PNG", "png"), ("WEBP", "webp")])
    def test_allowed_formats(self, api, citizen, issue, fmt, ext):
        api.force_authenticate(citizen)
        assert upload(api, issue, make_image_file(fmt, name=f"p.{ext}")).status_code == 201
        assert IssueImage.objects.get().image.name.endswith(f".{ext}")

    def test_extension_comes_from_detected_format_not_client_name(self, api, citizen, issue):
        api.force_authenticate(citizen)
        res = upload(api, issue, make_image_file("PNG", name="../../evil.php", content_type="application/x-php"))
        assert res.status_code == 201
        name = IssueImage.objects.get().image.name
        assert name.endswith(".png") and "evil" not in name and ".." not in name

    def test_exif_gps_is_stripped(self, api, citizen, issue):
        buf = BytesIO()
        exif = Image.Exif()
        exif[0x010F] = "SecretCameraMaker"
        Image.new("RGB", (30, 30), (1, 2, 3)).save(buf, format="JPEG", exif=exif)
        assert b"SecretCameraMaker" in buf.getvalue()
        api.force_authenticate(citizen)
        assert upload(api, issue, SimpleUploadedFile("a.jpg", buf.getvalue(), "image/jpeg")).status_code == 201
        stored = IssueImage.objects.get().image
        with stored.open("rb") as fh:
            assert b"SecretCameraMaker" not in fh.read()


class TestRejections:
    def test_gif_rejected(self, api, citizen, issue):
        api.force_authenticate(citizen)
        assert upload(api, issue, make_image_file("GIF", name="a.gif", content_type="image/gif")).status_code == 400

    def test_text_file_pretending_to_be_png(self, api, citizen, issue):
        api.force_authenticate(citizen)
        fake = SimpleUploadedFile("fake.png", b"<?php echo 1; ?>", "image/png")
        res = upload(api, issue, fake)
        assert res.status_code == 400
        assert not IssueImage.objects.exists()

    def test_truncated_image(self, api, citizen, issue):
        data = make_image_file("PNG", size=(200, 200)).read()
        api.force_authenticate(citizen)
        res = upload(api, issue, SimpleUploadedFile("t.png", data[: len(data) // 2], "image/png"))
        assert res.status_code == 400

    def test_empty_file(self, api, citizen, issue):
        api.force_authenticate(citizen)
        assert upload(api, issue, SimpleUploadedFile("e.png", b"", "image/png")).status_code == 400

    def test_oversized_file(self, api, citizen, issue, monkeypatch):
        monkeypatch.setattr(images, "MAX_BYTES", 100)
        api.force_authenticate(citizen)
        res = upload(api, issue, make_image_file("PNG", size=(100, 100)))
        assert res.status_code == 400
        assert "too large" in str(res.data["image"][0])

    def test_oversized_dimensions(self, api, citizen, issue, monkeypatch):
        monkeypatch.setattr(images, "MAX_PIXELS", 100)
        api.force_authenticate(citizen)
        assert upload(api, issue, make_image_file("PNG", size=(50, 50))).status_code == 400

    def test_missing_file_field(self, api, citizen, issue):
        api.force_authenticate(citizen)
        assert api.post(url(issue), {}, format="multipart").status_code == 400

    def test_max_images_per_issue(self, api, citizen, issue):
        api.force_authenticate(citizen)
        for _ in range(5):
            assert upload(api, issue, make_image_file()).status_code == 201
        assert upload(api, issue, make_image_file()).status_code == 400
        assert IssueImage.objects.count() == 5


class TestAccess:
    def test_other_citizen_forbidden_on_public_issue(self, api, other_citizen, issue, png):
        api.force_authenticate(other_citizen)
        assert upload(api, issue, png).status_code == 403
        assert not IssueImage.objects.exists()

    def test_other_citizen_404_on_hidden_issue(self, api, citizen, other_citizen, make_issue, png):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(other_citizen)
        assert upload(api, pending, png).status_code == 404

    def test_owner_can_attach_to_own_pending_issue(self, api, citizen, make_issue, png):
        pending = make_issue(citizen, approved=False)
        api.force_authenticate(citizen)
        assert upload(api, pending, png).status_code == 201

    def test_anonymous_401_and_officer_403(self, api, officer, issue, png):
        assert upload(api, issue, png).status_code == 401
        api.force_authenticate(officer)
        assert upload(api, issue, make_image_file()).status_code == 403

    def test_not_allowed_after_status_leaves_reported(self, api, citizen, issue, png):
        Issue.objects.filter(pk=issue.pk).update(status=Issue.Status.IN_PROGRESS)
        api.force_authenticate(citizen)
        assert upload(api, issue, png).status_code == 409

    def test_uploaded_image_shows_in_issue_detail(self, api, citizen, issue, png):
        api.force_authenticate(citizen)
        upload(api, issue, png)
        res = api.get(reverse("issue-detail", args=[issue.pk]))
        assert len(res.data["images"]) == 1
