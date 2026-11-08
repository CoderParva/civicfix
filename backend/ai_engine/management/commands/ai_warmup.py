"""Download and smoke-test the local AI models (development only).

    python manage.py ai_warmup                 # load both models and run one real inference through each
    python manage.py ai_warmup --image a.jpg   # also classify a real photo and print the ranking

The first run downloads the models (~0.6 GB) into .model-cache; later runs load from disk.
"""
import time

from django.core.management.base import BaseCommand, CommandError
from PIL import Image

from ai_engine import backends, services


class Command(BaseCommand):
    help = "Load the local AI models and run a real inference through each (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--image", help="Classify this image file and print the result.")

    def handle(self, *args, **options):
        if not backends.inference_enabled():
            raise CommandError("AI_INFERENCE is not 'local' in these settings: nothing to warm up.")

        backends.reset_backends()
        started = time.perf_counter()
        embedder = backends.get_text_embedder()
        if embedder is None:
            raise CommandError("The text model could not be loaded (see the log above). Run scripts/install-ai-libs.sh first.")
        vectors = embedder.embed(["a deep pothole on the road", "a big hole in the street", "garbage piled up"])
        similar = sum(a * b for a, b in zip(vectors[0], vectors[1]))
        different = sum(a * b for a, b in zip(vectors[0], vectors[2]))
        self.stdout.write(
            f"text   {embedder.name}: similar={similar:.2f} different={different:.2f} ({time.perf_counter() - started:.1f}s)"
        )

        started = time.perf_counter()
        classifier = backends.get_image_classifier()
        if classifier is None:
            raise CommandError("The image model could not be loaded (see the log above).")
        self.stdout.write(f"image  {classifier.name}: loaded in {time.perf_counter() - started:.1f}s")

        if options["image"]:
            started = time.perf_counter()
            with open(options["image"], "rb") as handle:
                result = services.classify_image(services.load_pil_image(handle))
            self.stdout.write(f"classified in {time.perf_counter() - started:.2f}s")
            self.stdout.write(f"status={result['status']} reason={result['reason']}")
            for item in result["suggestions"]:
                self.stdout.write(f"  {item['confidence']:.1%}  {item['category_name']}")
        else:
            result = services.classify_image(Image.new("RGB", (64, 64), (128, 128, 128)))
            self.stdout.write(f"image  smoke test ran: status={result['status']}")
        self.stdout.write(self.style.SUCCESS("AI models are working."))
