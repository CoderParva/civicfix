from .base import *  # noqa: F401,F403
from .base import SECRET_KEY as _SECRET_KEY

DEBUG = True
SECRET_KEY = _SECRET_KEY or "insecure-dev-only-key-do-not-use-in-production-0123456789"  # noqa: S105
ALLOWED_HOSTS = ["*"]
