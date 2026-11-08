"""The model layer: off by default, lazy, and a load failure is remembered but not forever."""
import subprocess
import sys
from pathlib import Path

import pytest

from ai_engine import backends

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Loaded:
    name = "loaded"
    version = "1"


def test_disabled_never_touches_a_model(settings, monkeypatch):
    settings.AI_INFERENCE = "disabled"
    monkeypatch.setattr(backends, "_sentence_transformer", lambda name: pytest.fail("a model was loaded"))
    assert backends.inference_enabled() is False
    assert backends.get_image_classifier() is None and backends.get_text_embedder() is None


def test_loaded_once_and_reused(settings, monkeypatch):
    settings.AI_INFERENCE = "local"
    calls = []
    monkeypatch.setattr(backends, "ClipImageClassifier", lambda name: calls.append(name) or Loaded())
    first, second = backends.get_image_classifier(), backends.get_image_classifier()
    assert first is second and calls == [settings.AI_IMAGE_MODEL]


def test_missing_libraries_mean_none_not_an_exception(settings, monkeypatch):
    settings.AI_INFERENCE = "local"
    monkeypatch.setattr(settings, "AI_LIBS_DIR", Path("/nonexistent"))
    monkeypatch.setitem(sys.modules, "sentence_transformers", None)  # makes `import sentence_transformers` raise ImportError
    assert backends.get_image_classifier() is None
    assert backends.get_text_embedder() is None


def test_a_failed_load_is_not_retried_on_every_request_but_is_retried_later(settings, monkeypatch):
    settings.AI_INFERENCE = "local"
    attempts = []

    def flaky(name):
        attempts.append(name)
        if len(attempts) == 1:
            raise OSError("offline")
        return Loaded()

    monkeypatch.setattr(backends, "SentenceEmbedder", flaky)
    clock = [1000.0]
    monkeypatch.setattr(backends.time, "monotonic", lambda: clock[0])

    assert backends.get_text_embedder() is None
    clock[0] += 5
    assert backends.get_text_embedder() is None and len(attempts) == 1  # within the retry window: no new attempt
    clock[0] += settings.AI_RETRY_SECONDS
    assert backends.get_text_embedder() is not None and len(attempts) == 2


def test_production_settings_pin_inference_off_even_if_the_environment_asks_otherwise():
    code = (
        "import os; os.environ['DJANGO_SECRET_KEY']='x'; os.environ['AI_INFERENCE']='local';"
        "from config.settings import production; print(production.AI_INFERENCE)"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=60)
    assert out.stdout.strip() == "disabled", out.stderr


def test_development_defaults_to_local_and_can_be_switched_off_by_environment():
    code = "import os; os.environ['AI_INFERENCE']='disabled'; from config.settings import development as d; print(d.AI_INFERENCE)"
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=60)
    assert out.stdout.strip() == "disabled", out.stderr
