#!/bin/sh
# Install the optional local-AI dependencies into ./.ai-libs (gitignored) from inside the web container:
#
#   docker compose exec web sh scripts/install-ai-libs.sh
#   docker compose exec web python manage.py ai_warmup      # downloads + smoke-tests the models
#
# The app imports them lazily (see ai_engine/backends.py). Without this step, or with
# AI_INFERENCE=disabled, every AI feature reports "unavailable" and the rest of the app is unaffected.
set -e
TARGET="${AI_LIBS_DIR:-/app/.ai-libs}"
pip install --no-cache-dir --upgrade --target "$TARGET" -r requirements/ai.txt
