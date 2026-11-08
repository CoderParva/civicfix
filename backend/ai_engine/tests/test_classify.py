"""Image classification: the "model available" path (fakes) and the "unavailable" path, service and API."""
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image

from ai_engine import services
from ai_engine.tests.conftest import FakeClassifier
from issues.models import IssueCategory

pytestmark = pytest.mark.django_db

URL = "ai-classify"


def pil():
    return Image.new("RGB", (32, 32), (120, 120, 120))


def upload(name="photo.png"):
    buf = BytesIO()
    pil().save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


class TestServiceWithModel:
    def test_confident_result_names_the_category_and_its_confidence(self, ai_local):
        ai_local.classifier = FakeClassifier({"pothole": 20})
        result = services.classify_image(pil())
        assert result["status"] == "ok" and result["reason"] == "confident"
        top = result["suggestions"][0]
        assert top["category_name"] == "Pothole" and top["confidence"] >= 0.5
        assert result["model"] == {"name": "fake-clip", "version": "test"}

    def test_suggestions_are_ranked_and_capped_at_three(self, ai_local):
        ai_local.classifier = FakeClassifier({"pothole": 10, "garbage": 5, "street lamp": 2, "drain": 1})
        confidences = [s["confidence"] for s in services.classify_image(pil())["suggestions"]]
        assert len(confidences) == 3 and confidences == sorted(confidences, reverse=True)

    def test_low_top_probability_is_uncertain_not_a_guess(self, ai_local):
        ai_local.classifier = FakeClassifier({})  # flat distribution: nothing stands out
        result = services.classify_image(pil())
        assert result["status"] == "uncertain" and result["reason"] == "low_confidence"
        assert result["suggestions"]  # still offered as options for the citizen to pick from

    def test_two_close_candidates_are_uncertain_even_if_both_are_strong(self, ai_local):
        ai_local.classifier = FakeClassifier({"pothole": 10, "cracked and damaged road": 9.5})
        result = services.classify_image(pil())
        assert result["status"] == "uncertain" and result["reason"] == "ambiguous"

    def test_a_photo_that_matches_the_not_a_civic_issue_prompts_is_uncertain(self, ai_local):
        ai_local.classifier = FakeClassifier({"selfie": 30, "pothole": 3})
        result = services.classify_image(pil())
        assert result["status"] == "uncertain" and result["reason"] == "not_a_civic_issue"

    def test_other_is_never_suggested(self, ai_local):
        names = {s["category_name"] for s in services.classify_image(pil())["suggestions"]}
        assert "Other" not in names

    def test_inactive_categories_are_not_offered(self, ai_local):
        IssueCategory.objects.filter(name="Pothole").update(is_active=False)
        ai_local.classifier = FakeClassifier({"pothole": 20})
        assert "Pothole" not in {s["category_name"] for s in services.classify_image(pil())["suggestions"]}

    def test_model_exception_becomes_unavailable_not_a_crash(self, ai_local):
        ai_local.classifier = FakeClassifier(error=RuntimeError("out of memory"))
        result = services.classify_image(pil())
        assert result["status"] == "unavailable" and result["reason"] == "error" and result["suggestions"] == []


class TestServiceWithoutModel:
    def test_disabled_inference_is_unavailable_and_loads_nothing(self, settings, monkeypatch):
        settings.AI_INFERENCE = "disabled"
        monkeypatch.setattr("ai_engine.backends._sentence_transformer", lambda name: pytest.fail("a model was loaded"))
        result = services.classify_image(pil())
        assert result == {"status": "unavailable", "reason": "disabled", "threshold": 0.5, "suggestions": [], "model": None}

    def test_local_but_model_failed_to_load_is_unavailable(self, settings, monkeypatch):
        settings.AI_INFERENCE = "local"
        monkeypatch.setattr("ai_engine.backends._sentence_transformer", lambda name: (_ for _ in ()).throw(ImportError("no torch")))
        result = services.classify_image(pil())
        assert result["status"] == "unavailable" and result["reason"] == "model_unavailable"


class TestEndpoint:
    def test_returns_the_suggestion_to_a_citizen(self, api, citizen, ai_local):
        ai_local.classifier = FakeClassifier({"garbage": 20})
        api.force_authenticate(citizen)
        res = api.post(reverse(URL), {"image": upload()}, format="multipart")
        assert res.status_code == 200
        assert res.data["status"] == "ok" and res.data["suggestions"][0]["category_name"] == "Garbage"

    def test_without_a_model_it_is_still_a_200_saying_unavailable(self, api, citizen):
        api.force_authenticate(citizen)
        res = api.post(reverse(URL), {"image": upload()}, format="multipart")
        assert res.status_code == 200
        assert res.data["status"] == "unavailable" and res.data["suggestions"] == []

    def test_a_non_image_is_rejected_like_any_upload(self, api, citizen, ai_local):
        api.force_authenticate(citizen)
        bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        res = api.post(reverse(URL), {"image": bad}, format="multipart")
        assert res.status_code == 400

    def test_image_is_required(self, api, citizen):
        api.force_authenticate(citizen)
        assert api.post(reverse(URL), {}, format="multipart").status_code == 400

    def test_requires_a_citizen_login(self, api, officer):
        assert api.post(reverse(URL), {"image": upload()}, format="multipart").status_code == 401
        api.force_authenticate(officer)
        assert api.post(reverse(URL), {"image": upload()}, format="multipart").status_code == 403

    def test_is_rate_limited(self, api, citizen, monkeypatch):
        from rest_framework.throttling import SimpleRateThrottle

        monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "ai_classify", "2/hour")
        api.force_authenticate(citizen)
        codes = [api.post(reverse(URL), {"image": upload()}, format="multipart").status_code for _ in range(3)]
        assert codes == [200, 200, 429]
