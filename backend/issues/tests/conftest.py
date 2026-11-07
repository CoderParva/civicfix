from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from accounts.models import User
from issues import services
from issues.models import Issue, IssueCategory

# Indore, Rajwada
INDORE = (22.7196, 75.8577)


@pytest.fixture
def category(db):
    return IssueCategory.objects.get(name="Pothole")  # seeded by migration 0002


@pytest.fixture
def other_citizen(make_user):
    return make_user("other@example.com", User.Role.CITIZEN)


@pytest.fixture
def make_issue(db, category):
    def _make(reporter, *, approved=True, lat=INDORE[0], lng=INDORE[1], title="Big pothole on MG Road", **extra):
        issue = services.create_issue(
            reporter=reporter,
            category=category,
            title=title,
            description="A deep pothole that is dangerous for two-wheelers.",
            latitude=lat,
            longitude=lng,
            address="MG Road",
        )
        updates = {"moderation_status": Issue.ModerationStatus.APPROVED if approved else Issue.ModerationStatus.PENDING}
        updates.update(extra)
        Issue.objects.filter(pk=issue.pk).update(**updates)
        issue.refresh_from_db()
        return issue

    return _make


@pytest.fixture
def issue(make_issue, citizen):
    """An approved, public issue owned by `citizen`."""
    return make_issue(citizen)


@pytest.fixture
def issue_payload(category):
    return {
        "category": category.pk,
        "title": "Streetlight broken near park",
        "description": "The streetlight has been off for two weeks and the road is dark at night.",
        "latitude": INDORE[0],
        "longitude": INDORE[1],
        "address": "Near Nehru Park",
        "landmark": "Opposite bus stop",
    }


def make_image_file(fmt="PNG", size=(40, 30), name="photo.png", content_type="image/png"):
    buf = BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buf, format=fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type=content_type)


@pytest.fixture
def png():
    return make_image_file()
