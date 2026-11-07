import pytest
from django.urls import reverse

from issues.tests.conftest import INDORE

pytestmark = pytest.mark.django_db

URL = "issue-nearby"
# ~0.009 degrees of latitude is ~1 km
NORTH_1KM = (INDORE[0] + 0.009, INDORE[1])
NORTH_5KM = (INDORE[0] + 0.045, INDORE[1])
BHOPAL = (23.2599, 77.4126)


def query(api, **params):
    params.setdefault("lat", INDORE[0])
    params.setdefault("lng", INDORE[1])
    return api.get(reverse(URL), params)


class TestNearby:
    def test_returns_issues_within_radius_nearest_first(self, api, citizen, make_issue):
        far = make_issue(citizen, lat=NORTH_5KM[0], lng=NORTH_5KM[1], title="Five km away issue")
        near = make_issue(citizen, lat=NORTH_1KM[0], lng=NORTH_1KM[1], title="One km away issue")
        here = make_issue(citizen, title="Right here issue")
        make_issue(citizen, lat=BHOPAL[0], lng=BHOPAL[1], title="Bhopal issue")
        res = query(api, radius=10000)
        assert res.status_code == 200
        assert [i["id"] for i in res.data["results"]] == [str(here.pk), str(near.pk), str(far.pk)]
        distances = [i["distance_m"] for i in res.data["results"]]
        assert distances == sorted(distances)
        assert distances[0] < 5
        assert 900 < distances[1] < 1100
        assert 4800 < distances[2] < 5200

    def test_radius_filters(self, api, citizen, make_issue):
        make_issue(citizen, title="Right here issue")
        make_issue(citizen, lat=NORTH_5KM[0], lng=NORTH_5KM[1], title="Five km away issue")
        assert query(api, radius=2000).data["count"] == 1
        assert query(api, radius=6000).data["count"] == 2

    def test_default_radius_is_one_km(self, api, citizen, make_issue):
        make_issue(citizen, title="Right here issue")
        make_issue(citizen, lat=NORTH_5KM[0], lng=NORTH_5KM[1], title="Five km away issue")
        assert query(api).data["count"] == 1

    def test_only_public_approved_issues(self, api, citizen, make_issue):
        make_issue(citizen, approved=False, title="Pending nearby issue")
        make_issue(citizen, is_public=False, title="Private nearby issue")
        make_issue(citizen, moderation_status="rejected", title="Rejected nearby issue")
        owner_view = query(api)
        assert owner_view.data["count"] == 0
        api.force_authenticate(citizen)  # even the owner doesn't get their pending issue here
        assert query(api).data["count"] == 0

    def test_fully_serialized_with_counts(self, api, citizen, make_issue):
        make_issue(citizen)
        item = query(api).data["results"][0]
        assert {"vote_count", "comment_count", "location", "category", "distance_m"} <= set(item)

    @pytest.mark.parametrize(
        "params",
        [
            {"lat": None},
            {"lng": None},
            {"lat": 91},
            {"lng": -181},
            {"lat": "north"},
            {"radius": 0},
            {"radius": 20001},
            {"radius": "far"},
        ],
    )
    def test_invalid_params(self, api, params):
        clean = {k: v for k, v in params.items() if v is not None}
        base = {"lat": INDORE[0], "lng": INDORE[1]}
        for key, value in params.items():
            if value is None:
                base.pop(key)
        base.update(clean)
        assert api.get(reverse(URL), base).status_code == 400

    def test_no_params_is_400(self, api):
        assert api.get(reverse(URL)).status_code == 400
