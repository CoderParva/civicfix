"""Priority recommendation: plain, explainable rules. No model, no I/O, runs anywhere (production too).

score = category weight + the strongest safety-keyword group + vote bonus + age bonus
Every point is listed in `reasons`, so an admin can see why an issue was ranked as it was.
"""
import re
from dataclasses import dataclass, field

VERSION = "rules-v1"

# Base urgency by category (matched on lower-cased name). Unknown / new categories get DEFAULT_CATEGORY_POINTS.
CATEGORY_POINTS = {
    "pothole": 2,
    "road damage": 2,
    "water leakage": 2,
    "drainage": 2,
    "streetlight": 1,
    "garbage": 1,
    "other": 0,
}
DEFAULT_CATEGORY_POINTS = 1

# Safety language, strongest first. Only the highest group that matches counts, so a report that
# shouts five danger words is not ranked above one that names a single, genuinely deadly hazard.
# Phrases match whole words ("fire" does not match "fireplace"); a trailing * means "any ending"
# ("electrocut*" matches electrocuted, electrocution).
SAFETY_GROUPS = (
    (
        4,
        "life-threatening hazard",
        (
            "live wire", "exposed wire", "electrocut*", "electric shock", "short circuit", "sparking", "sparks",
            "open manhole", "uncovered manhole", "missing manhole", "gas leak", "collaps*", "accident*",
            "injur*", "fatal*", "fire",
        ),
    ),
    (
        2,
        "safety risk",
        (
            "dangerous", "unsafe", "hazard*", "risk*", "child", "children", "school*", "hospital*", "elderly",
            "highway", "flood*", "sewage", "overflow*", "blocked road", "no light", "pitch dark",
            "dark at night", "fell", "fallen",
        ),
    ),
)

VOTE_STEPS = ((30, 3), (15, 2), (5, 1))  # (votes at least, points)
AGE_STEPS = ((30, 3), (14, 2), (7, 1))  # (days open at least, points)

LEVELS = ((7, "critical"), (4, "high"), (2, "medium"), (0, "low"))


@dataclass
class PriorityRecommendation:
    priority: str
    score: int
    reasons: list[dict] = field(default_factory=list)
    version: str = VERSION

    def to_dict(self):
        return {
            "priority": self.priority,
            "score": self.score,
            "reasons": self.reasons,
            "method": "rules",
            "version": self.version,
        }


def _contains(text, phrase):
    stem = phrase.endswith("*")
    body = re.escape(phrase.rstrip("*"))
    pattern = rf"\b{body}" if stem else rf"\b{body}\b"
    return re.search(pattern, text) is not None


def recommend(*, category_name="", title="", description="", votes=0, age_days=0.0) -> PriorityRecommendation:
    text = f"{title} {description}".lower()
    reasons = []

    key = (category_name or "").strip().lower()
    points = CATEGORY_POINTS.get(key, DEFAULT_CATEGORY_POINTS)
    reasons.append({"factor": "category", "detail": category_name or "Unknown category", "points": points})
    score = points

    for weight, label, phrases in SAFETY_GROUPS:
        hit = next((p for p in phrases if _contains(text, p)), None)
        if hit:
            reasons.append({"factor": label, "detail": f"mentions “{hit}”", "points": weight})
            score += weight
            break

    for threshold, bonus in VOTE_STEPS:
        if votes >= threshold:
            reasons.append({"factor": "community votes", "detail": f"{votes} residents are affected", "points": bonus})
            score += bonus
            break

    for threshold, bonus in AGE_STEPS:
        if age_days >= threshold:
            reasons.append({"factor": "waiting time", "detail": f"open for {int(age_days)} days", "points": bonus})
            score += bonus
            break

    level = next(name for floor, name in LEVELS if score >= floor)
    return PriorityRecommendation(priority=level, score=score, reasons=reasons)
