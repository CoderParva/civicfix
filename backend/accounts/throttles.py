from rest_framework.throttling import AnonRateThrottle


class LoginThrottle(AnonRateThrottle):
    """Per client IP. Slows password guessing; the rate is in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]."""

    scope = "auth_login"


class RegisterThrottle(AnonRateThrottle):
    scope = "auth_register"


class RefreshThrottle(AnonRateThrottle):
    scope = "auth_refresh"
