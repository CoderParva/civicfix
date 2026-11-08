"""Fakes for the two model backends, so the service logic is tested without torch.

`ai_local` switches AI_INFERENCE to "local" and plugs the fakes in -- i.e. the "model available" path.
Without it the suite runs the "AI unavailable" path (the root conftest turns inference off).
"""
import re
from types import SimpleNamespace

import pytest

from ai_engine import backends

# Reuse the issues test fixtures (category, make_issue, issue_payload, png, ...).
from issues.tests.conftest import category, issue, issue_payload, make_issue, other_citizen, png  # noqa: F401


class FakeClassifier:
    """label_probabilities() puts probability on prompts mentioning a keyword in `leaning` (word -> weight)."""

    name = "fake-clip"
    version = "test"

    def __init__(self, leaning=None, error=None):
        self.leaning = leaning or {}
        self.error = error
        self.calls = []

    def label_probabilities(self, image, prompts):
        self.calls.append(prompts)
        if self.error:
            raise self.error
        weights = [0.01 + sum(w for word, w in self.leaning.items() if word in prompt) for prompt in prompts]
        total = sum(weights)
        return [w / total for w in weights]


class FakeEmbedder:
    """Hashes words into a small vector: texts sharing words are similar, unrelated texts are near 0."""

    name = "fake-minilm"
    version = "test"
    DIM = 64

    def __init__(self, error=None):
        self.error = error

    def embed(self, texts):
        if self.error:
            raise self.error
        vectors = []
        for text in texts:
            vec = [0.0] * self.DIM
            for word in re.findall(r"[a-z]+", text.lower()):
                vec[hash(word) % self.DIM] += 1.0
            norm = sum(v * v for v in vec) ** 0.5 or 1.0
            vectors.append([v / norm for v in vec])
        return vectors


@pytest.fixture
def ai_local(settings, monkeypatch):
    """Model-available mode. Returns a namespace to tweak the fakes: ai.classifier, ai.embedder."""
    settings.AI_INFERENCE = "local"
    ai = SimpleNamespace(classifier=FakeClassifier({"pothole": 5}), embedder=FakeEmbedder())
    monkeypatch.setattr(backends, "get_image_classifier", lambda: ai.classifier)
    monkeypatch.setattr(backends, "get_text_embedder", lambda: ai.embedder)
    return ai
