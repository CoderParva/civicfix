from rest_framework.exceptions import APIException


class Conflict(APIException):
    status_code = 409
    default_detail = "The request conflicts with the current state of the resource."
    default_code = "conflict"


class InvalidStatusTransition(Conflict):
    default_detail = "This status transition is not allowed."
    default_code = "invalid_status_transition"


class IssueNotEditable(Conflict):
    default_detail = "Only issues in REPORTED status can be edited."
    default_code = "issue_not_editable"
