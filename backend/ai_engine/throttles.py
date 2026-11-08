from rest_framework.throttling import UserRateThrottle


class AIClassifyThrottle(UserRateThrottle):
    scope = "ai_classify"


class AIDuplicatesThrottle(UserRateThrottle):
    scope = "ai_duplicates"


class AIPriorityThrottle(UserRateThrottle):
    scope = "ai_priority"
