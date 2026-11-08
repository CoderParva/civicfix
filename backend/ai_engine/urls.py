from django.urls import path

from . import views

urlpatterns = [
    path("ai/classify/", views.ClassifyView.as_view(), name="ai-classify"),
    path("ai/duplicates/", views.DuplicatesView.as_view(), name="ai-duplicates"),
    path("ai/priority/", views.PriorityView.as_view(), name="ai-priority"),
    path("ai/analysis/<uuid:issue_id>/", views.AnalysisView.as_view(), name="ai-analysis"),
]
