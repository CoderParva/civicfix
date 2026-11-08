"""The pluggable model layer: real models in local development, "unavailable" everywhere else.

Everything heavy (torch, sentence-transformers) is imported lazily, here and only here, and only when
settings.AI_INFERENCE == "local". `get_image_classifier()` / `get_text_embedder()` return a backend
object, or None when AI is off, the libraries are not installed, or the model could not be loaded.
Callers treat None as "no suggestion"; they never see an exception from a missing model.

A backend is anything with `name`, `version` and the one method of its kind:
    classifier.label_probabilities(image: PIL.Image, prompts: list[str]) -> list[float]  (sums to 1)
    embedder.embed(texts: list[str]) -> list[list[float]]                               (L2-normalised)
Tests plug in fakes by patching these two getters.
"""
import logging
import sys
import threading
import time

from django.conf import settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache = {}  # kind -> (backend | None, failed_at | None)


def inference_enabled():
    return getattr(settings, "AI_INFERENCE", "disabled") == "local"


def reset_backends():
    """Forget loaded models and remembered failures (used by tests and the warm-up command)."""
    with _lock:
        _cache.clear()


def _expose_ai_libs():
    """Make ./.ai-libs importable (appended, so the app's own packages always win)."""
    libs = str(settings.AI_LIBS_DIR)
    if settings.AI_LIBS_DIR.is_dir() and libs not in sys.path:
        sys.path.append(libs)


def _sentence_transformer(model_name):
    _expose_ai_libs()
    settings.AI_MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name, cache_folder=str(settings.AI_MODEL_CACHE_DIR), device="cpu")


class ClipImageClassifier:
    """Zero-shot image classification with CLIP: which text prompt does this photo match best?"""

    version = "zero-shot"

    def __init__(self, model_name):
        self.name = model_name
        self._model = _sentence_transformer(model_name)

    def label_probabilities(self, image, prompts):
        import numpy as np

        image_vec = self._model.encode([image], normalize_embeddings=True, convert_to_numpy=True)
        text_vecs = self._model.encode(prompts, normalize_embeddings=True, convert_to_numpy=True)
        logits = 100.0 * (image_vec @ text_vecs.T)[0]  # 100 is CLIP's learned logit scale
        logits -= logits.max()
        exp = np.exp(logits)
        return (exp / exp.sum()).tolist()


class SentenceEmbedder:
    """Sentence embeddings, for "do these two reports describe the same thing?"."""

    version = "sbert"

    def __init__(self, model_name):
        self.name = model_name
        self._model = _sentence_transformer(model_name)

    def embed(self, texts):
        return self._model.encode(texts, normalize_embeddings=True, convert_to_numpy=True).tolist()


def _get(kind, factory, model_name):
    if not inference_enabled():
        return None
    with _lock:
        backend, failed_at = _cache.get(kind, (None, None))
        if backend is not None:
            return backend
        if failed_at is not None and time.monotonic() - failed_at < settings.AI_RETRY_SECONDS:
            return None  # recently failed: don't retry on every request
        try:
            backend = factory(model_name)
        except Exception:  # not installed, offline first run, corrupt cache, out of memory...
            logger.warning("AI model %s is unavailable; suggestions will be skipped", model_name, exc_info=True)
            _cache[kind] = (None, time.monotonic())
            return None
        _cache[kind] = (backend, None)
        return backend


def get_image_classifier():
    return _get("image", ClipImageClassifier, settings.AI_IMAGE_MODEL)


def get_text_embedder():
    return _get("text", SentenceEmbedder, settings.AI_TEXT_MODEL)
