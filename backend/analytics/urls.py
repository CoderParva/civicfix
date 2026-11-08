from django.urls import path

from . import views

urlpatterns = [
    path("admin/analytics/", views.AdminAnalyticsView.as_view(), name="admin-analytics"),
    path("officer/analytics/", views.OfficerAnalyticsView.as_view(), name="officer-analytics"),
]
