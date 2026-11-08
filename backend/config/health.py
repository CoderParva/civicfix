from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    """Liveness probe for Render, and (with ?db=1) a database round-trip for the keep-alive job.

    No auth, nothing sensitive: just "ok" or "the database is unreachable". The keep-alive GitHub Action calls
    it with ?db=1 so that Supabase sees real activity and never auto-pauses the free project.
    """
    body = {"status": "ok"}
    if request.GET.get("db") in ("1", "true"):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            body["database"] = "ok"
        except Exception:
            return JsonResponse({"status": "error", "database": "unreachable"}, status=503)
    return JsonResponse(body)
