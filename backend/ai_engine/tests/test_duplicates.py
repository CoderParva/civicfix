"""Duplicate detection: PostGIS radius + (semantic | word-overlap) similarity, service and API."""
import pytest
from django.urls import reverse

from ai_engine import services
from issues import services as issue_services
from issues.models import Issue
from issues.tests.conftest import INDORE

pytestmark = pytest.mark.django_db

URL = "ai-duplicates"
LAT, LNG = INDORE


def offset(metres_north):
    return LAT + metres_north / 111_320.0


@pytest.fixture
def pothole(make_issue, citizen):
    return make_issue(citizen, title="Deep pothole on MG Road near Rajwada", lat=LAT, lng=LNG)


def check(**overrides):
    args = dict(
        latitude=LAT,
        longitude=LNG,
        title="Deep pothole on MG Road near Rajwada",
        description="A deep pothole that is dangerous for two-wheelers.",
    )
    args.update(overrides)
    return services.find_duplicates(**args)


class TestWithModel:
    def test_same_problem_same_spot_is_a_likely_duplicate(self, ai_local, pothole, category):
        result = check(category_id=category.pk)
        assert result["method"] == "semantic"
        (match,) = result["matches"]
        assert match["id"] == str(pothole.pk) and match["likelihood"] == "likely"
        assert match["distance_m"] <= 1 and match["score"] >= 0.7
        assert set(match) >= {"reference_number", "title", "category", "status", "distance_m", "score", "reported_at"}

    def test_a_different_problem_at_the_same_spot_is_not_flagged(self, ai_local, pothole):
        result = check(title="Garbage heaped beside the shop", description="Rubbish and smell, flies everywhere")
        assert result["matches"] == []

    def test_distance_matters(self, ai_local, make_issue, citizen, category):
        make_issue(citizen, title="Deep pothole on MG Road near Rajwada", lat=offset(100))
        near = check(category_id=category.pk)["matches"]
        make_issue(citizen, title="Deep pothole on MG Road near Rajwada", lat=offset(400))  # outside 150 m
        assert len(check(category_id=category.pk)["matches"]) == len(near) == 1

    def test_matches_are_ranked_best_first(self, ai_local, make_issue, citizen, category):
        far = make_issue(citizen, title="Deep pothole on MG Road near Rajwada", lat=offset(120))
        close = make_issue(citizen, title="Deep pothole on MG Road near Rajwada", lat=offset(5))
        ids = [m["id"] for m in check(category_id=category.pk)["matches"]]
        assert ids == [str(close.pk), str(far.pk)]

    def test_embedder_failure_falls_back_to_word_overlap(self, ai_local, pothole, category):
        from ai_engine.tests.conftest import FakeEmbedder

        ai_local.embedder = FakeEmbedder(error=RuntimeError("boom"))
        result = check(category_id=category.pk)
        assert result["method"] == "lexical" and len(result["matches"]) == 1


class TestWithoutModel:
    def test_still_finds_the_obvious_duplicate_by_location_and_words(self, pothole, category):
        result = check(category_id=category.pk)  # AI is off in this test: no embedder at all
        assert result["method"] == "lexical"
        assert [m["id"] for m in result["matches"]] == [str(pothole.pk)]

    def test_nothing_nearby_is_an_empty_list_not_an_error(self):
        assert check() == {"method": "none", "radius_m": 150, "matches": []}


class TestVisibility:
    def test_citizens_are_only_compared_with_public_reports(self, make_issue, citizen, category):
        make_issue(citizen, title="Deep pothole on MG Road near Rajwada", approved=False)  # still pending
        assert check(category_id=category.pk)["matches"] == []
        assert len(check(category_id=category.pk, include_hidden=True)["matches"]) == 1

    def test_rejected_reports_are_never_matches(self, make_issue, citizen, category):
        rejected = make_issue(citizen, title="Deep pothole on MG Road near Rajwada")
        Issue.objects.filter(pk=rejected.pk).update(status=Issue.Status.REJECTED)
        assert check(category_id=category.pk, include_hidden=True)["matches"] == []

    def test_old_reports_are_not_compared(self, make_issue, citizen, category):
        from datetime import timedelta

        from django.utils import timezone

        old = make_issue(citizen, title="Deep pothole on MG Road near Rajwada")
        Issue.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=400))
        assert check(category_id=category.pk, include_hidden=True)["matches"] == []

    def test_same_spot_and_category_alone_is_not_enough_without_similar_text(self, make_issue, citizen, category):
        make_issue(citizen, title="Zebra crossing paint faded away")
        result = check(title="Entirely different words here", description="Nothing in common whatsoever", category_id=category.pk)
        assert result["matches"] == []

    def test_an_issue_is_never_its_own_duplicate(self, pothole, category):
        assert check(category_id=category.pk, exclude_issue_id=pothole.pk, include_hidden=True)["matches"] == []


class TestEndpoint:
    def body(self, **extra):
        return {"latitude": LAT, "longitude": LNG, "title": "Deep pothole on MG Road near Rajwada", "description": "dangerous", **extra}

    def test_citizen_checks_a_draft_report(self, api, citizen, other_citizen, pothole, category):
        api.force_authenticate(other_citizen)
        res = api.post(reverse(URL), self.body(category=category.pk), format="json")
        assert res.status_code == 200
        assert [m["id"] for m in res.data["matches"]] == [str(pothole.pk)]

    def test_a_citizen_cannot_use_issue_id_to_probe_other_reports(self, api, citizen, pothole):
        api.force_authenticate(citizen)
        assert api.post(reverse(URL), {"issue_id": str(pothole.pk)}, format="json").status_code == 403

    def test_admin_can_check_an_existing_issue_against_all_others(self, api, admin_user, make_issue, citizen, pothole):
        twin = make_issue(citizen, title="Deep pothole on MG Road near Rajwada", approved=False)
        api.force_authenticate(admin_user)
        res = api.post(reverse(URL), {"issue_id": str(twin.pk)}, format="json")
        assert res.status_code == 200 and [m["id"] for m in res.data["matches"]] == [str(pothole.pk)]

    def test_validation(self, api, citizen):
        api.force_authenticate(citizen)
        assert api.post(reverse(URL), {"title": "x"}, format="json").status_code == 400
        assert api.post(reverse(URL), {"latitude": 91, "longitude": 0}, format="json").status_code == 400

    def test_login_and_role_required(self, api, officer):
        assert api.post(reverse(URL), {"latitude": 1, "longitude": 1}, format="json").status_code == 401
        api.force_authenticate(officer)
        assert api.post(reverse(URL), {"latitude": 1, "longitude": 1}, format="json").status_code == 403


def test_create_issue_records_the_matches_for_the_admin(ai_local, pothole, citizen, category):
    twin = issue_services.create_issue(
        reporter=citizen, category=category, title="Deep pothole on MG Road near Rajwada",
        description="A deep pothole that is dangerous for two-wheelers.", latitude=LAT, longitude=LNG,
    )
    analysis = twin.ai_analysis
    assert analysis.duplicate_score >= 0.7
    assert analysis.result["duplicates"]["matches"][0]["id"] == str(pothole.pk)
