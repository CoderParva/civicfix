"""Server-side validation and sanitising of uploaded issue photos.

The client's filename and Content-Type are never trusted: the real format is detected by
Pillow, the image is decoded and re-encoded (which drops EXIF/GPS metadata and any
trailing payload), and the stored extension comes from the detected format.
"""
from io import BytesIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps
from rest_framework.exceptions import ValidationError

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 25_000_000  # ~5000x5000; stops decompression bombs before decoding
ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


def _fail(message):
    raise ValidationError({"image": [message]})


def sanitize_image(upload):
    """Return a ContentFile (re-encoded, safely named) or raise a 400 ValidationError."""
    if upload.size > MAX_BYTES:
        _fail(f"Image is too large (max {MAX_BYTES // (1024 * 1024)} MB).")
    if upload.size == 0:
        _fail("The uploaded file is empty.")

    try:
        upload.seek(0)
        probe = Image.open(upload)
        fmt = probe.format
        if fmt not in ALLOWED_FORMATS:
            _fail("Unsupported image type. Upload a JPEG, PNG or WebP image.")
        width, height = probe.size
        if width * height > MAX_PIXELS:
            _fail("Image dimensions are too large.")
        probe.verify()

        upload.seek(0)
        img = Image.open(upload)
        img.load()  # first frame only
        img = ImageOps.exif_transpose(img)
        if fmt == "JPEG" and img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        out = BytesIO()
        options = {"quality": 85, "optimize": True} if fmt in ("JPEG", "WEBP") else {"optimize": True}
        img.save(out, format=fmt, **options)  # no exif= passed => metadata dropped
    except ValidationError:
        raise
    except Exception:  # corrupt data, truncated file, decompression bomb, not an image...
        _fail("The uploaded file is not a valid image.")

    return ContentFile(out.getvalue(), name=f"upload.{ALLOWED_FORMATS[fmt]}")
