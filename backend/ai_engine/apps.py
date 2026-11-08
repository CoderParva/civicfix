import os
import sys
import threading

from django.apps import AppConfig


def _preload():
    from . import backends

    for name, getter in (("text", backends.get_text_embedder), ("image", backends.get_image_classifier)):
        loaded = getter()
        # dev-server console feedback (no logging config in dev would swallow logger.info)
        sys.stderr.write(f"[ai_engine] {name} model {'ready: ' + loaded.name if loaded else 'unavailable'}" + chr(10))
        sys.stderr.flush()


class AIEngineConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ai_engine"

    def ready(self):
        """Development convenience: warm the models in the background when the dev server starts, so the
        first person to upload a photo does not wait a minute for them to load.

        Only for `runserver` in local-inference mode (and only in the process that serves requests, not the
        autoreload parent). Tests, migrations, shells and production never start it.
        """
        from django.conf import settings

        if getattr(settings, "AI_INFERENCE", "disabled") != "local" or "runserver" not in sys.argv:
            return
        if os.environ.get("RUN_MAIN") != "true" and "--noreload" not in sys.argv:
            return
        threading.Thread(target=_preload, name="ai-preload", daemon=True).start()
