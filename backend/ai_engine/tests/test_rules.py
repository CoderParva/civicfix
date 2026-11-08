"""Priority rules are pure: no database, no model. Every score must be explainable from `reasons`."""
import pytest

from ai_engine.rules import recommend


def points(rec):
    return sum(r["points"] for r in rec.reasons)


def test_score_is_exactly_the_sum_of_the_listed_reasons():
    rec = recommend(category_name="Pothole", title="Child fell near school", description="Very dangerous", votes=16, age_days=15)
    assert rec.score == points(rec)
    assert {r["factor"] for r in rec.reasons} == {"category", "safety risk", "community votes", "waiting time"}


@pytest.mark.parametrize(
    "category, expected",
    [("Pothole", "medium"), ("Garbage", "low"), ("Streetlight", "low"), ("Drainage", "medium"), ("Other", "low")],
)
def test_plain_report_is_ranked_by_category_alone(category, expected):
    assert recommend(category_name=category, title="Something here", description="Needs fixing").priority == expected


def test_unknown_category_gets_a_neutral_default_not_an_error():
    rec = recommend(category_name="Brand new category", title="x", description="y")
    assert rec.reasons[0]["points"] == 1 and rec.priority == "low"


def test_safety_keywords_raise_priority():
    plain = recommend(category_name="Pothole", title="Pothole on MG Road", description="Large hole in the road")
    deadly = recommend(category_name="Pothole", title="Pothole on MG Road", description="A bike rider had an accident here")
    assert plain.priority == "medium"
    assert deadly.priority == "high"
    assert any(r["factor"] == "life-threatening hazard" and "accident" in r["detail"] for r in deadly.reasons)


def test_only_the_strongest_safety_group_counts():
    rec = recommend(category_name="Garbage", title="Live wire in a flooded school area", description="dangerous and unsafe")
    safety = [r for r in rec.reasons if r["factor"] in ("life-threatening hazard", "safety risk")]
    assert len(safety) == 1 and safety[0]["points"] == 4


def test_keywords_match_whole_words_unless_they_are_marked_as_stems():
    assert recommend(category_name="Other", title="Prefire", description="the fireplace and firewood are fine").score == 0
    assert recommend(category_name="Other", title="Fire near the market", description="smoke").score == 4
    assert recommend(category_name="Other", title="Man electrocuted", description="by a cable").score == 4  # "electrocut*" stem


def test_votes_and_age_add_bonuses_at_each_step():
    base = recommend(category_name="Garbage", title="t", description="d").score
    assert recommend(category_name="Garbage", title="t", description="d", votes=5).score == base + 1
    assert recommend(category_name="Garbage", title="t", description="d", votes=15).score == base + 2
    assert recommend(category_name="Garbage", title="t", description="d", votes=40).score == base + 3
    assert recommend(category_name="Garbage", title="t", description="d", age_days=8).score == base + 1
    assert recommend(category_name="Garbage", title="t", description="d", age_days=31).score == base + 3


def test_critical_needs_several_independent_signals():
    one_signal = recommend(category_name="Streetlight", title="Live wire hanging", description="sparking")
    many = recommend(category_name="Water leakage", title="Live wire in water", description="near a school", votes=20, age_days=3)
    assert one_signal.priority == "high"
    assert many.priority == "critical"


def test_result_is_json_serialisable_and_labelled_as_rules():
    data = recommend(category_name="Pothole", title="a", description="b").to_dict()
    assert data["method"] == "rules" and data["version"] == "rules-v1"
    assert set(data) == {"priority", "score", "reasons", "method", "version"}
