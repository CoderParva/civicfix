import pytest
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from common.permissions import IsCitizen, IsDepartmentOfficer, IsSuperAdmin

pytestmark = pytest.mark.django_db

factory = APIRequestFactory()

# permission class -> role fixtures that must be allowed; every other role must get 403
MATRIX = [
    (IsCitizen, {"citizen"}),
    (IsDepartmentOfficer, {"officer"}),
    (IsSuperAdmin, {"admin_user"}),
]


def view_for(permission):
    class DummyView(APIView):
        permission_classes = [permission]

        def get(self, request):
            return Response({"ok": True})

    return DummyView.as_view()


@pytest.mark.parametrize("permission,allowed", MATRIX, ids=[m[0].__name__ for m in MATRIX])
@pytest.mark.parametrize("who", ["citizen", "officer", "admin_user"])
def test_permission_matrix(permission, allowed, who, request):
    user = request.getfixturevalue(who)
    req = factory.get("/")
    force_authenticate(req, user=user)
    status = view_for(permission)(req).status_code
    assert status == (200 if who in allowed else 403)


@pytest.mark.parametrize("permission", [IsCitizen, IsDepartmentOfficer, IsSuperAdmin])
def test_anonymous_is_denied(permission):
    res = view_for(permission)(factory.get("/"))
    assert res.status_code in (401, 403)


@pytest.mark.parametrize("permission,fixture", [(IsCitizen, "citizen"), (IsDepartmentOfficer, "officer"), (IsSuperAdmin, "admin_user")])
def test_inactive_user_is_denied(permission, fixture, request):
    user = request.getfixturevalue(fixture)
    user.is_active = False
    user.save()
    req = factory.get("/")
    force_authenticate(req, user=user)
    assert view_for(permission)(req).status_code == 403
