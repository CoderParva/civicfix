"""Production settings fail fast on anything unsafe, and `manage.py check --deploy` is clean.

Each case runs a fresh interpreter, because settings are read once at import and from the environment.
"""
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]

GOOD_ENV = {
    "DJANGO_SETTINGS_MODULE": "config.settings.production",
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(50),
    "DJANGO_ALLOWED_HOSTS": "civicfix-api.onrender.com",
    "CORS_ALLOWED_ORIGINS": "https://civicfix.pages.dev",
    "MEDIA_S3_ENDPOINT_URL": "https://abcd.storage.supabase.co/storage/v1/s3",
    "MEDIA_S3_REGION": "ap-south-1",
    "MEDIA_S3_ACCESS_KEY_ID": "AKIAEXAMPLE",
    "MEDIA_S3_SECRET_ACCESS_KEY": "secret-example",
    "MEDIA_S3_BUCKET": "issue-photos",
    "MEDIA_PUBLIC_BASE_URL": "https://abcd.supabase.co/storage/v1/object/public/issue-photos",
}
DUMP = (
    "import json; from django.conf import settings as s; "
    "o = s.STORAGES['default'].get('OPTIONS', {}); "
    "print(json.dumps({'hosts': s.ALLOWED_HOSTS, 'cors': s.CORS_ALLOWED_ORIGINS, 'csrf': s.CSRF_TRUSTED_ORIGINS, "
    "'storage': s.STORAGES['default']['BACKEND'], 'domain': o.get('custom_domain'), 'proto': o.get('url_protocol'), "
    "'ai': s.AI_INFERENCE, 'debug': s.DEBUG, 'sslmode': s.DATABASES['default']['OPTIONS'].get('sslmode'), "
    "'static': s.STORAGES['staticfiles']['BACKEND']}))"
)


def run(env_changes=None, drop=(), code=DUMP, args=None):
    env = {**os.environ, **GOOD_ENV, **(env_changes or {})}
    for name in drop:
        env.pop(name, None)
    env.pop("RENDER_EXTERNAL_HOSTNAME", None) if "RENDER_EXTERNAL_HOSTNAME" not in (env_changes or {}) else None
    command = [sys.executable, *(args or ["-c", f"import django; django.setup(); {code}"])]
    return subprocess.run(command, cwd=BACKEND_DIR, env=env, capture_output=True, text=True, timeout=90)


def loads(env_changes=None, drop=()):
    done = run(env_changes, drop)
    assert done.returncode == 0, done.stderr[-800:]
    return json.loads(done.stdout.strip().splitlines()[-1])


def refused(env_changes=None, drop=(), mentions=""):
    done = run(env_changes, drop)
    assert done.returncode != 0, "the settings should have been refused"
    assert "ImproperlyConfigured" in done.stderr and mentions in done.stderr, done.stderr[-600:]


def test_a_complete_configuration_loads_and_is_locked_down():
    cfg = loads()
    assert cfg["hosts"] == ["civicfix-api.onrender.com"]
    assert cfg["cors"] == ["https://civicfix.pages.dev"]
    assert cfg["csrf"] == ["https://civicfix-api.onrender.com"]
    assert cfg["storage"] == "storages.backends.s3.S3Storage"
    assert cfg["domain"] == "abcd.supabase.co/storage/v1/object/public/issue-photos" and cfg["proto"] == "https:"
    assert cfg["debug"] is False and cfg["sslmode"] == "require"
    assert cfg["static"] == "whitenoise.storage.CompressedStaticFilesStorage"


def test_ai_is_off_in_production_whatever_the_environment_says():
    assert loads({"AI_INFERENCE": "local"})["ai"] == "disabled"


def test_render_adds_its_own_hostname_automatically():
    assert loads({"RENDER_EXTERNAL_HOSTNAME": "civicfix-api-x1y2.onrender.com"})["hosts"] == [
        "civicfix-api.onrender.com",
        "civicfix-api-x1y2.onrender.com",
    ]


@pytest.mark.parametrize(
    "changes, drop, mentions",
    [
        ({"DJANGO_SECRET_KEY": "short"}, (), "DJANGO_SECRET_KEY"),
        ({"DJANGO_SECRET_KEY": "insecure-dev-only-key-do-not-use-in-production-0123456789"}, (), "DJANGO_SECRET_KEY"),
        ({}, ("DJANGO_SECRET_KEY",), "DJANGO_SECRET_KEY"),
        ({}, ("DJANGO_ALLOWED_HOSTS",), "DJANGO_ALLOWED_HOSTS"),
        ({"DJANGO_ALLOWED_HOSTS": "*"}, (), "DJANGO_ALLOWED_HOSTS"),
        ({"DJANGO_ALLOWED_HOSTS": "api.example.com,*"}, (), "DJANGO_ALLOWED_HOSTS"),
        ({}, ("CORS_ALLOWED_ORIGINS",), "CORS_ALLOWED_ORIGINS"),
        ({"CORS_ALLOWED_ORIGINS": "*"}, (), "CORS_ALLOWED_ORIGINS"),
        ({"CORS_ALLOWED_ORIGINS": "http://civicfix.pages.dev"}, (), "https origin"),
        ({"CORS_ALLOWED_ORIGINS": "https://civicfix.pages.dev/app"}, (), "no path"),
        ({"CORS_ALLOWED_ORIGINS": "https://ok.example.com,http://localhost:5173"}, (), "https origin"),
        ({}, ("MEDIA_S3_ACCESS_KEY_ID",), "MEDIA_S3_ACCESS_KEY_ID"),
        ({}, ("MEDIA_PUBLIC_BASE_URL", "MEDIA_S3_BUCKET"), "MEDIA_S3_BUCKET, MEDIA_PUBLIC_BASE_URL"),
        ({"MEDIA_PUBLIC_BASE_URL": "http://abcd.supabase.co/x"}, (), "https URLs"),
        ({"MEDIA_STORAGE": "ftp"}, (), "MEDIA_STORAGE"),
    ],
)
def test_unsafe_or_missing_settings_stop_the_process_at_startup(changes, drop, mentions):
    refused(changes, drop, mentions)


def test_the_local_simulation_switches_are_explicit_and_narrow():
    # MEDIA_STORAGE=local and an http origin are only accepted together with SSL redirect turned off.
    local = loads({"MEDIA_STORAGE": "local", "DJANGO_SECURE_SSL_REDIRECT": "false", "CORS_ALLOWED_ORIGINS": "http://localhost:5173"})
    assert local["storage"] == "django.core.files.storage.FileSystemStorage"
    refused({"CORS_ALLOWED_ORIGINS": "http://localhost:5173"}, mentions="https origin")


def test_database_ssl_can_be_relaxed_only_through_its_own_variable():
    assert loads({"DATABASE_SSLMODE": "prefer"})["sslmode"] == "prefer"


def test_transaction_pooler_mode_disables_server_side_cursors():
    code = "print(s.DATABASES['default'].get('DISABLE_SERVER_SIDE_CURSORS'), s.DATABASES['default']['OPTIONS'].get('prepare_threshold', 'unset'))"
    done = run({"DATABASE_TRANSACTION_POOLER": "true"}, code="from django.conf import settings as s; " + code)
    assert done.stdout.split()[-2:] == ["True", "None"], done.stderr[-400:]


def test_manage_py_check_deploy_has_no_warnings_apart_from_the_two_we_accept():
    done = run(args=["manage.py", "check", "--deploy"])
    assert done.returncode == 0, done.stderr[-800:]
    import re

    warned = set(re.findall(r"[(]security[.]W[0-9]+[)]", done.stdout + done.stderr))
    assert "drf_spectacular" not in done.stdout + done.stderr, "the API schema should generate without warnings"
    # W005/W021 ask for includeSubDomains / preload on a domain; on a shared *.onrender.com host that is not ours to set.
    assert warned <= {"(security.W005)", "(security.W021)"}, (done.stdout + done.stderr)[-1200:]


def test_the_health_check_is_exempt_from_the_https_redirect():
    code = (
        "from django.test import Client; c = Client(HTTP_HOST='civicfix-api.onrender.com'); "
        "r = c.get('/api/v1/health/'); print(r.status_code); "
        "r = c.get('/api/v1/categories/'); print(r.status_code, r['Location'])"
    )
    done = run(code=code)
    assert done.stdout.split() == ["200", "301", "https://civicfix-api.onrender.com/api/v1/categories/"], done.stderr[-500:]
