"""Production settings (Render web service + Supabase Postgres/Storage + Cloudflare Pages frontend).

Everything environment-specific comes from environment variables, and a missing or unsafe value stops the
process at start-up with a message saying what to fix, instead of running with a quietly weak default.
See DEPLOYMENT.md for the full variable checklist.
"""
import os
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F401,F403
from .base import DATABASES, MIDDLEWARE, SECRET_KEY, env_bool, env_list
from ..storage import s3_storage_options

DEBUG = False

# --- secrets and hosts ------------------------------------------------------------------------

if len(SECRET_KEY) < 32 or SECRET_KEY.startswith("insecure") or "change-me" in SECRET_KEY:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set to a long random value in production")

# False only for simulating production on a local machine without TLS (never on a real deployment).
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
_REAL_DEPLOYMENT = SECURE_SSL_REDIRECT

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if os.environ.get("RENDER_EXTERNAL_HOSTNAME"):  # set automatically by Render
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])
if not ALLOWED_HOSTS or any(host.strip() in ("*", ".") for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list the exact production hostname(s); '*' is not allowed")

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
if not CORS_ALLOWED_ORIGINS:
    raise ImproperlyConfigured("CORS_ALLOWED_ORIGINS must list the frontend origin(s), e.g. https://civicfix.pages.dev")
for _origin in CORS_ALLOWED_ORIGINS:
    _parts = urlsplit(_origin)
    if _origin == "*" or not _parts.netloc or _parts.path not in ("", "/") or (_REAL_DEPLOYMENT and _parts.scheme != "https"):
        raise ImproperlyConfigured(f"CORS_ALLOWED_ORIGINS entry {_origin!r} must be an https origin with no path")
CORS_ALLOWED_ORIGINS = [origin.rstrip("/") for origin in CORS_ALLOWED_ORIGINS]

# The Django admin lives on the API host; behind Render's TLS proxy its POSTs carry that https origin.
CSRF_TRUSTED_ORIGINS = [f"https://{host}" for host in ALLOWED_HOSTS if not host.startswith(".")]

# --- transport security -----------------------------------------------------------------------

MIDDLEWARE = MIDDLEWARE.copy()
MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# Render's health check calls the container over plain HTTP; it must not be bounced to https.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health/$"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# --- client IP behind Render's proxy ------------------------------------------------------------
# Rate limits are per client IP. Behind a proxy REMOTE_ADDR is the proxy, so every visitor would share one
# counter. DRF reads X-Forwarded-For and, with NUM_PROXIES = n, trusts the n-th entry from the right (the one
# the platform's own proxy appended), which a client cannot forge. Render: 1 (verify per DEPLOYMENT.md).
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": int(os.environ.get("TRUSTED_PROXY_COUNT", "1"))}  # noqa: F405

# --- database (Supabase Postgres) -------------------------------------------------------------
# Render's free tier is IPv4-only and Supabase's direct host is IPv6-only: use the *pooler* connection string
# from the Supabase dashboard (Session mode, port 5432, user postgres.<project-ref>) as DATABASE_URL.

DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"].setdefault("sslmode", os.environ.get("DATABASE_SSLMODE", "require"))
if env_bool("DATABASE_TRANSACTION_POOLER"):  # only if you chose the pooler's Transaction mode (port 6543)
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
    DATABASES["default"]["OPTIONS"]["prepare_threshold"] = None

# --- files: static (whitenoise) and uploads (Supabase Storage, S3-compatible) ------------------

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

MEDIA_STORAGE = os.environ.get("MEDIA_STORAGE", "s3")
if MEDIA_STORAGE == "s3":
    _required = (
        "MEDIA_S3_ENDPOINT_URL",
        "MEDIA_S3_REGION",
        "MEDIA_S3_ACCESS_KEY_ID",
        "MEDIA_S3_SECRET_ACCESS_KEY",
        "MEDIA_S3_BUCKET",
        "MEDIA_PUBLIC_BASE_URL",
    )
    _missing = [name for name in _required if not os.environ.get(name)]
    if _missing:
        raise ImproperlyConfigured(
            f"Object storage is not configured: set {', '.join(_missing)} (Render's disk is ephemeral, so photos "
            "cannot live on it). For a local simulation only, set MEDIA_STORAGE=local."
        )
    _public = urlsplit(os.environ["MEDIA_PUBLIC_BASE_URL"].rstrip("/"))
    if _REAL_DEPLOYMENT and (_public.scheme != "https" or not os.environ["MEDIA_S3_ENDPOINT_URL"].startswith("https://")):
        raise ImproperlyConfigured("MEDIA_PUBLIC_BASE_URL and MEDIA_S3_ENDPOINT_URL must be https URLs")

    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": s3_storage_options(
            endpoint_url=os.environ["MEDIA_S3_ENDPOINT_URL"],
            region=os.environ["MEDIA_S3_REGION"],
            access_key=os.environ["MEDIA_S3_ACCESS_KEY_ID"],
            secret_key=os.environ["MEDIA_S3_SECRET_ACCESS_KEY"],
            bucket=os.environ["MEDIA_S3_BUCKET"],
            public_base_url=os.environ["MEDIA_PUBLIC_BASE_URL"],
        ),
    }
elif MEDIA_STORAGE != "local":
    raise ImproperlyConfigured("MEDIA_STORAGE must be 's3' (default) or 'local' (local simulation only)")

# --- AI ---------------------------------------------------------------------------------------
# The Render free tier (0.1 vCPU / 512 MB) cannot run PyTorch. Pinned, not read from the environment,
# so a stray AI_INFERENCE variable can never switch model loading on in production.
AI_INFERENCE = "disabled"

# --- logging: Render shows stdout/stderr, so send everything there ----------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
    "loggers": {"django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}
