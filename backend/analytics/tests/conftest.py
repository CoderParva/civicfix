# Reuse the departments/issues fixtures: importing a fixture function into a conftest registers it here.
from departments.tests.conftest import (  # noqa: F401
    assigned_issue,
    category,
    colleague,
    dept,
    in_progress_issue,
    issue,
    issue_payload,
    make_issue,
    make_officer,
    officer_profile,
    other_citizen,
    other_dept,
    other_officer,
    png,
    put_in_state,
)
