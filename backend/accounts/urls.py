from django.urls import path

from .views import LoginView, ProfileView, RefreshView, RegisterView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("token/refresh/", RefreshView.as_view(), name="auth-token-refresh"),
    path("profile/", ProfileView.as_view(), name="auth-profile"),
]
