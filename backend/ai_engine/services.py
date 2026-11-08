"""AI service layer: classify_image, find_duplicates, recommend_priority, plus the glue that records them.

The contract every public function keeps: *a missing or broken model degrades to "no suggestion",
never an exception*. Priority is plain rules and always works. Classification needs the image model;
duplicate detection always runs its PostGIS radius query and adds semantic text similarity when the
text model is there (otherwise it falls back to word overlap and says so).
"""
import logging
import re
from collections import defaultdict
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from issues.models import Issue, IssueCategory
from locations.queries import within_radius

from . import backends, rules
from .models import AIAnalysis

logger = logging.getLogger(__name__)

# ---- classification -------------------------------------------------------------------------------

# What CLIP is asked to match a photo against. Several phrasings per category; their probabilities add up.
CATEGORY_PROMPTS = {
    "pothole": ["a photo of a pothole in a road", "a photo of a hole in the asphalt of a street"],
    "garbage": ["a photo of a pile of garbage on a street", "a photo of litter and rubbish dumped on the roadside"],
    "streetlight": ["a photo of a street lamp post", "a photo of a broken streetlight on a pole"],
    "water leakage": ["a photo of water leaking from a burst pipe", "a photo of water flowing across a road from a pipe"],
    "drainage": ["a photo of a blocked drain with dirty water", "a photo of an overflowing sewer or open drain"],
    "road damage": ["a photo of a cracked and damaged road surface", "a photo of a broken road edge and crumbling pavement"],
}
# Things that are clearly not a civic problem. They soak up probability so a selfie or a screenshot
# does not get confidently filed under whichever category happens to be least wrong.
NOT_CIVIC_PROMPTS = [
    "a photo of a person's face, a selfie",
    "a photo of an indoor room",
    "a photo of a pet or an animal",
    "a screenshot of text or a document",
    "a photo of food on a plate",
    "a photo of a clean, undamaged street",
]
MAX_SUGGESTIONS = 3
IMAGE_MAX_SIDE = 768  # CLIP resizes to 224 anyway; this just avoids decoding huge photos at full size


def _prompts_for(category):
    return CATEGORY_PROMPTS.get(category.name.lower()) or [f"a photo of {category.name.lower()}"]


def _classification_unavailable(reason):
    return {
        "status": "unavailable",
        "reason": reason,
        "threshold": settings.AI_CONFIDENCE_THRESHOLD,
        "suggestions": [],
        "model": None,
    }


def classify_image(image):
    """Suggest a category for a PIL image. Returns a plain dict; never raises.

    status: "ok" (confident, clear winner) | "uncertain" (the citizen should choose; guesses are still listed)
            | "unavailable" (no model). Nothing here assigns anything: it is a suggestion.
    """
    if not backends.inference_enabled():
        return _classification_unavailable("disabled")
    classifier = backends.get_image_classifier()
    if classifier is None:
        return _classification_unavailable("model_unavailable")

    categories = list(IssueCategory.objects.filter(is_active=True).exclude(name__iexact="Other"))
    if not categories:
        return _classification_unavailable("no_categories")

    prompts, owner = [], []  # owner[i] = the category a prompt belongs to, or None for "not civic"
    for category in categories:
        for prompt in _prompts_for(category):
            prompts.append(prompt)
            owner.append(category)
    for prompt in NOT_CIVIC_PROMPTS:
        prompts.append(prompt)
        owner.append(None)

    try:
        probabilities = classifier.label_probabilities(image, prompts)
    except Exception:
        logger.warning("Image classification failed", exc_info=True)
        return _classification_unavailable("error")

    per_category, not_civic = defaultdict(float), 0.0
    for category, probability in zip(owner, probabilities):
        if category is None:
            not_civic += probability
        else:
            per_category[category] += probability
    ranked = sorted(per_category.items(), key=lambda item: item[1], reverse=True)
    suggestions = [
        {"category_id": category.pk, "category_name": category.name, "confidence": round(probability, 4)}
        for category, probability in ranked[:MAX_SUGGESTIONS]
    ]

    top = ranked[0][1]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    if not_civic >= 0.5:  # most of the probability went to "this is not a civic problem"
        status, reason = "uncertain", "not_a_civic_issue"
    elif top < settings.AI_CONFIDENCE_THRESHOLD:
        status, reason = "uncertain", "low_confidence"
    elif top - runner_up < settings.AI_CONFIDENCE_MARGIN:
        status, reason = "uncertain", "ambiguous"
    else:
        status, reason = "ok", "confident"

    return {
        "status": status,
        "reason": reason,
        "threshold": settings.AI_CONFIDENCE_THRESHOLD,
        "suggestions": suggestions,
        "model": {"name": classifier.name, "version": classifier.version},
    }


def load_pil_image(file):
    """Open an uploaded/stored image file as a small RGB PIL image."""
    from PIL import Image

    image = Image.open(file)
    image.load()
    image = image.convert("RGB")
    image.thumbnail((IMAGE_MAX_SIDE, IMAGE_MAX_SIDE))
    return image


# ---- duplicate detection --------------------------------------------------------------------------

_STOPWORDS = frozenset(
    "the a an and or of on in at to for is are was were be been it its this that with near by from has have had "
    "there here very too not no and but road street area".split()
)
WEIGHT_TEXT, WEIGHT_GEO, WEIGHT_CATEGORY = 0.55, 0.30, 0.15
MAX_CANDIDATES = 20


def _tokens(text):
    words = (w.rstrip("s") if len(w) > 3 else w for w in re.findall(r"[a-z0-9]+", text.lower()))
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def _lexical_similarity(a, b):
    ta, tb = _tokens(a), _tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _issue_text(title, description):
    return f"{title}. {description}".strip()


def find_duplicates(
    *, latitude, longitude, title, description, category_id=None, exclude_issue_id=None, include_hidden=False, limit=5
):
    """Reports near this spot that look like the same problem. Returns a dict; never raises on AI problems.

    Candidates come from a PostGIS radius query (always available). Each is scored 0..1 from text
    similarity (semantic when the text model is installed, word overlap otherwise), closeness and
    whether the category matches. `include_hidden=False` limits candidates to what the public can see,
    which is what a citizen is allowed to be shown; admins pass True to compare against pending reports too.
    """
    candidates = Issue.objects.filter(created_at__gte=timezone.now() - timedelta(days=settings.AI_DUPLICATE_MAX_AGE_DAYS))
    candidates = candidates.exclude(status=Issue.Status.REJECTED).exclude(moderation_status=Issue.ModerationStatus.REJECTED)
    if not include_hidden:
        candidates = candidates.filter(moderation_status=Issue.ModerationStatus.APPROVED, is_public=True)
    if exclude_issue_id is not None:
        candidates = candidates.exclude(pk=exclude_issue_id)
    radius = settings.AI_DUPLICATE_RADIUS_M
    nearby = list(
        within_radius(candidates, latitude=latitude, longitude=longitude, radius_m=radius).select_related("category")[:MAX_CANDIDATES]
    )
    if not nearby:
        return {"method": "none", "radius_m": radius, "matches": []}

    query_text = _issue_text(title, description)
    texts = [_issue_text(c.title, c.description) for c in nearby]
    method, similarities = "lexical", None
    embedder = backends.get_text_embedder()
    if embedder is not None:
        try:
            vectors = embedder.embed([query_text, *texts])
            query_vec = vectors[0]
            similarities = [max(0.0, sum(x * y for x, y in zip(query_vec, vec))) for vec in vectors[1:]]
            method = "semantic"
        except Exception:
            logger.warning("Semantic similarity failed; falling back to word overlap", exc_info=True)
    if similarities is None:
        similarities = [_lexical_similarity(query_text, text) for text in texts]

    matches = []
    for candidate, text_similarity in zip(nearby, similarities):
        distance_m = candidate.distance.m
        closeness = max(0.0, 1.0 - distance_m / radius)
        same_category = 1.0 if category_id is not None and candidate.category_id == category_id else 0.0
        score = WEIGHT_TEXT * text_similarity + WEIGHT_GEO * closeness + WEIGHT_CATEGORY * same_category
        if score < settings.AI_DUPLICATE_MIN_SCORE:
            continue
        matches.append(
            {
                "id": str(candidate.pk),
                "reference_number": candidate.reference_number,
                "title": candidate.title,
                "category": {"id": candidate.category_id, "name": candidate.category.name},
                "status": candidate.status,
                "distance_m": round(distance_m),
                "score": round(score, 3),
                "text_similarity": round(text_similarity, 3),
                "likelihood": "likely" if score >= settings.AI_DUPLICATE_LIKELY_SCORE else "possible",
                "reported_at": candidate.created_at.isoformat(),
            }
        )
    matches.sort(key=lambda m: m["score"], reverse=True)
    return {"method": method, "radius_m": radius, "matches": matches[:limit]}


# ---- priority -------------------------------------------------------------------------------------


def recommend_priority(*, category_name="", title="", description="", votes=0, age_days=0.0):
    return rules.recommend(
        category_name=category_name, title=title, description=description, votes=votes, age_days=age_days
    ).to_dict()


# ---- recording ------------------------------------------------------------------------------------


def _derive_status(result):
    """COMPLETED only when no stage ran in a degraded form; PARTIAL otherwise (the normal state in production)."""
    degraded = result.get("duplicates", {}).get("method") == "lexical"
    degraded = degraded or result.get("classification", {}).get("status") == "unavailable"
    return AIAnalysis.ProcessingStatus.PARTIAL if degraded else AIAnalysis.ProcessingStatus.COMPLETED


def analyze_new_issue(issue):
    """Run the cheap stages for a freshly created issue and store them. Called inline from create_issue."""
    analysis, _ = AIAnalysis.objects.get_or_create(issue=issue)
    result = dict(analysis.result)

    priority = recommend_priority(
        category_name=issue.category.name, title=issue.title, description=issue.description, votes=0, age_days=0
    )
    result["priority"] = priority
    analysis.suggested_priority = priority["priority"]

    duplicates = find_duplicates(
        latitude=issue.location.y,
        longitude=issue.location.x,
        title=issue.title,
        description=issue.description,
        category_id=issue.category_id,
        exclude_issue_id=issue.pk,
        include_hidden=True,
    )
    result["duplicates"] = duplicates
    analysis.duplicate_score = max((m["score"] for m in duplicates["matches"]), default=0.0)

    analysis.result = result
    analysis.processing_status = _derive_status(result)
    analysis.save()
    return analysis


def analyze_issue_image(issue_id):
    """Classify the issue's first report photo and record how it compares with the reporter's own category.

    Runs after the photo is stored. It never changes the issue: the reporter's category stands, and the
    admin sees the model's opinion next to it.
    """
    from issues.models import IssueImage

    issue = Issue.objects.select_related("category").get(pk=issue_id)
    analysis, _ = AIAnalysis.objects.get_or_create(issue=issue)
    if "classification" in analysis.result:  # classify once, from the first photo
        return analysis
    photo = issue.images.filter(image_type=IssueImage.ImageType.REPORT).first()
    if photo is None:
        return analysis

    with photo.image.open("rb") as handle:
        classification = classify_image(load_pil_image(handle))
    classification["agrees_with_reporter"] = (
        bool(classification["suggestions"]) and classification["suggestions"][0]["category_id"] == issue.category_id
    )
    result = dict(analysis.result)
    result["classification"] = classification
    analysis.result = result
    if classification["suggestions"]:
        top = classification["suggestions"][0]
        analysis.predicted_category = top["category_name"]
        analysis.confidence = top["confidence"]
    if classification["model"]:
        analysis.model_name = classification["model"]["name"]
        analysis.model_version = classification["model"]["version"]
    analysis.processing_status = _derive_status(result)
    analysis.save()
    return analysis


def safely(function, *args, **kwargs):
    """Run an analysis step for its side effect; an AI problem must never fail the request that triggered it."""
    try:
        with transaction.atomic():  # a savepoint: a DB error in here can't poison the caller's transaction
            return function(*args, **kwargs)
    except Exception:
        logger.exception("AI analysis step %s failed", getattr(function, "__name__", function))
        return None
