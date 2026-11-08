"""AIAnalysis recording, the admin read endpoint, and the promise that AI can never break reporting."""
import pytest
from django.urls import reverse

from ai_engine import services
from ai_engine.models import AIAnalysis
from ai_engine.tests.conftest import FakeClassifier
from issues.models import Issue

pytestmark = pytest.mark.django_db

CREATE = "issue-list"


def post_issue(api, citizen, payload):
    api.force_authenticate(citizen)
    return api.post(reverse(CREATE), payload, format="json")


def post_photo(api, issue, png):
    return api.post(reverse("issue-images", args=[issue.pk]), {"image": png}, format="multipart")


class TestInlineAnalysisOnCreate:
    def test_priority_suggestion_is_stored_and_the_issue_priority_is_untouched(self, api, citizen, issue_payload):
        issue_payload["description"] = "A cyclist had an accident here, it is a deadly hole in the road."
        res = post_issue(api, citizen, issue_payload)
        assert res.status_code == 201
        analysis = AIAnalysis.objects.get(issue_id=res.data["id"])
        assert analysis.suggested_priority == "high"  # Pothole (2) + accident (4) = 6
        assert res.data["priority"] == "medium"  # the recommendation is advice; the issue keeps its default

    def test_a_dangerous_report_scores_higher_and_says_why(self, api, citizen, issue_payload):
        issue_payload["description"] = "Exposed wire sparking near the school gate, children walk here."
        res = post_issue(api, citizen, issue_payload)
        analysis = AIAnalysis.objects.get(issue_id=res.data["id"])
        assert analysis.suggested_priority == "high"
        factors = [r["factor"] for r in analysis.result["priority"]["reasons"]]
        assert "life-threatening hazard" in factors

    def test_without_a_model_the_analysis_is_partial_but_present(self, api, citizen, issue_payload, make_issue):
        make_issue(citizen, title="Streetlight broken near park", lat=issue_payload["latitude"], lng=issue_payload["longitude"])
        res = post_issue(api, citizen, issue_payload)
        analysis = AIAnalysis.objects.get(issue_id=res.data["id"])
        assert analysis.processing_status == "partial"  # duplicates fell back to word overlap
        assert analysis.result["duplicates"]["method"] == "lexical"
        assert analysis.result["priority"]["method"] == "rules"

    def test_with_a_model_the_analysis_is_completed(self, api, citizen, issue_payload, ai_local):
        res = post_issue(api, citizen, issue_payload)
        analysis = AIAnalysis.objects.get(issue_id=res.data["id"])
        assert analysis.processing_status == "completed"

    def test_a_crash_in_the_analysis_never_fails_the_report(self, api, citizen, issue_payload, monkeypatch):
        monkeypatch.setattr(services, "analyze_new_issue", lambda issue: 1 / 0)
        res = post_issue(api, citizen, issue_payload)
        assert res.status_code == 201
        assert Issue.objects.filter(pk=res.data["id"]).exists()
        assert not AIAnalysis.objects.filter(issue_id=res.data["id"]).exists()

    def test_a_database_error_in_the_analysis_does_not_poison_the_report_transaction(self, api, citizen, issue_payload, monkeypatch):
        from django.db import connection

        def broken(issue):
            with connection.cursor() as cursor:
                cursor.execute("SELECT * FROM table_that_does_not_exist")

        monkeypatch.setattr(services, "analyze_new_issue", broken)
        res = post_issue(api, citizen, issue_payload)
        assert res.status_code == 201 and Issue.objects.filter(pk=res.data["id"]).exists()


class TestPhotoClassification:
    def make(self, api, citizen, issue_payload):
        res = post_issue(api, citizen, issue_payload)
        return Issue.objects.get(pk=res.data["id"])

    def test_first_photo_is_classified_and_compared_with_the_reporters_category(self, api, citizen, issue_payload, png, ai_local):
        ai_local.classifier = FakeClassifier({"street lamp": 20})
        issue = self.make(api, citizen, issue_payload)  # reporter chose Pothole
        issue.category = type(issue.category).objects.get(name="Streetlight")
        issue.save(update_fields=["category"])
        assert post_photo(api, issue, png).status_code == 201
        analysis = AIAnalysis.objects.get(issue=issue)
        assert analysis.predicted_category == "Streetlight" and analysis.confidence >= 0.5
        assert analysis.model_name == "fake-clip"
        assert analysis.result["classification"]["agrees_with_reporter"] is True

    def test_a_disagreement_is_recorded_but_the_category_is_never_changed(self, api, citizen, issue_payload, png, ai_local):
        ai_local.classifier = FakeClassifier({"garbage": 20})
        issue = self.make(api, citizen, issue_payload)  # reporter chose something other than Garbage
        before = issue.category_id
        post_photo(api, issue, png)
        analysis = AIAnalysis.objects.get(issue=issue)
        assert analysis.predicted_category == "Garbage"
        assert analysis.result["classification"]["agrees_with_reporter"] is False
        issue.refresh_from_db()
        assert issue.category_id == before

    def test_only_the_first_photo_is_classified(self, api, citizen, issue_payload, png, ai_local):
        issue = self.make(api, citizen, issue_payload)
        post_photo(api, issue, png)
        png.seek(0)
        post_photo(api, issue, png)
        assert len(ai_local.classifier.calls) == 1

    def test_without_a_model_the_upload_still_succeeds(self, api, citizen, issue_payload, png):
        issue = self.make(api, citizen, issue_payload)
        assert post_photo(api, issue, png).status_code == 201
        analysis = AIAnalysis.objects.get(issue=issue)
        assert analysis.result["classification"]["status"] == "unavailable"
        assert analysis.predicted_category == "" and analysis.confidence is None

    def test_a_model_crash_does_not_fail_the_upload(self, api, citizen, issue_payload, png, ai_local):
        ai_local.classifier = FakeClassifier(error=RuntimeError("boom"))
        issue = self.make(api, citizen, issue_payload)
        assert post_photo(api, issue, png).status_code == 201
        assert issue.images.count() == 1


class TestAnalysisEndpoint:
    def url(self, issue):
        return reverse("ai-analysis", args=[issue.pk])

    def test_admin_reads_the_stored_analysis(self, api, admin_user, citizen, issue_payload):
        res = post_issue(api, citizen, issue_payload)
        api.force_authenticate(admin_user)
        res = api.get(reverse("ai-analysis", args=[res.data["id"]]))
        assert res.status_code == 200
        assert res.data["processing_status"] in {"partial", "completed"}
        assert res.data["suggested_priority"] in {"low", "medium", "high", "critical"}
        assert res.data["reported_category"] == "Pothole"
        assert set(res.data["result"]) >= {"priority", "duplicates"}

    def test_an_issue_without_analysis_gets_a_clear_empty_answer_not_a_404(self, api, admin_user, issue):
        AIAnalysis.objects.filter(issue=issue).delete()
        api.force_authenticate(admin_user)
        res = api.get(self.url(issue))
        assert res.status_code == 200
        assert res.data["processing_status"] == "not_analyzed" and res.data["result"] == {}

    def test_unknown_issue_is_404(self, api, admin_user):
        api.force_authenticate(admin_user)
        assert api.get(reverse("ai-analysis", args=["00000000-0000-0000-0000-000000000000"])).status_code == 404

    def test_only_admins(self, api, citizen, officer, issue):
        assert api.get(self.url(issue)).status_code == 401
        for user in (citizen, officer):
            api.force_authenticate(user)
            assert api.get(self.url(issue)).status_code == 403
