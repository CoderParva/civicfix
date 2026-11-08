from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

api_v1 = [
    path("auth/", include("accounts.urls")),
    path("", include("issues.urls")),
    path("", include("departments.urls")),
    path("", include("analytics.urls")),
    path("", include("ai_engine.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
]

if settings.DEBUG:  # dev only; production serves media from object storage
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
