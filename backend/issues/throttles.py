from rest_framework.throttling import UserRateThrottle


class IssueCreateThrottle(UserRateThrottle):
    scope = "issue_create"


class CommentCreateThrottle(UserRateThrottle):
    scope = "comment_create"


class ImageUploadThrottle(UserRateThrottle):
    scope = "image_upload"


class ContentReportThrottle(UserRateThrottle):
    scope = "content_report"
