"""Staff-facing serializers (officers, admins).

DepartmentNote's serializer lives here and nowhere else. Nothing under issues/ imports it, and
issues.serializers.IssueSerializer has no field for `department_notes`, so a citizen endpoint
cannot leak a note by forgetting a filter: there is simply no code path that renders one.
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accounts.serializers import RegisterSerializer
from issues.serializers import IssueSerializer

from .models import Department, DepartmentNote, IssueAssignment, OfficerProfile


class OfficerSummarySerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.full_name", read_only=True)

    class Meta:
        model = OfficerProfile
        fields = ["id", "name", "employee_reference"]


class DepartmentSerializer(serializers.ModelSerializer):
    officers = OfficerSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Department
        fields = ["id", "name", "description", "city", "is_active", "officers"]
        read_only_fields = ["id", "officers"]

    def validate(self, attrs):
        # The DB has a case-insensitive unique (name, city); mirror it here for a clean 400.
        name = attrs.get("name", getattr(self.instance, "name", ""))
        city = attrs.get("city", getattr(self.instance, "city", ""))
        clash = Department.objects.filter(name__iexact=name, city__iexact=city)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError({"name": "A department with this name already exists in this city."})
        return attrs


class AssignmentSerializer(serializers.ModelSerializer):
    department = serializers.SerializerMethodField()
    officer = OfficerSummarySerializer(read_only=True)

    class Meta:
        model = IssueAssignment
        fields = ["id", "department", "officer", "status", "rejection_reason", "assigned_at", "accepted_at"]
        read_only_fields = fields

    def get_department(self, obj) -> dict:
        return {"id": str(obj.department_id), "name": obj.department.name}


def _current_assignment(issue):
    """Uses the prefetched `assignments`; at most one is active (DB constraint)."""
    for assignment in issue.assignments.all():
        if assignment.status in IssueAssignment.ACTIVE_STATUSES:
            return AssignmentSerializer(assignment).data
    return None


class OfficerIssueSerializer(IssueSerializer):
    """What an officer sees: the public issue plus the current assignment. No reporter identity."""

    assignment = serializers.SerializerMethodField()

    class Meta(IssueSerializer.Meta):
        fields = IssueSerializer.Meta.fields + ["assignment"]
        read_only_fields = fields

    @extend_schema_field(AssignmentSerializer(allow_null=True))
    def get_assignment(self, obj):
        return _current_assignment(obj)


class AdminIssueSerializer(IssueSerializer):
    """Full moderation view: any moderation state, reporter, flag count and current assignment."""

    reporter = serializers.SerializerMethodField()
    report_count = serializers.IntegerField(read_only=True)
    assignment = serializers.SerializerMethodField()

    class Meta(IssueSerializer.Meta):
        fields = IssueSerializer.Meta.fields + ["reporter", "report_count", "assignment"]
        read_only_fields = fields

    def to_representation(self, instance):
        # Skip IssueSerializer's owner-only filtering: admins always see moderation_status / is_public.
        return super(IssueSerializer, self).to_representation(instance)

    def get_reporter(self, obj) -> dict:
        return {"id": str(obj.reporter_id), "full_name": obj.reporter.full_name, "email": obj.reporter.email}

    @extend_schema_field(AssignmentSerializer(allow_null=True))
    def get_assignment(self, obj):
        return _current_assignment(obj)


class DepartmentNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="officer.user.full_name", read_only=True)
    department = serializers.CharField(source="officer.department.name", read_only=True)

    class Meta:
        model = DepartmentNote
        fields = ["id", "author_name", "department", "note", "created_at"]
        read_only_fields = fields


class NoteCreateSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)  # blank/whitespace-only is rejected by default


class AssignSerializer(serializers.Serializer):
    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all())
    officer = serializers.PrimaryKeyRelatedField(
        queryset=OfficerProfile.objects.select_related("user", "department"),
        help_text="OfficerProfile id (listed under each department's `officers`).",
    )


class ResolveSerializer(serializers.Serializer):
    image = serializers.FileField(required=False, help_text="Resolution photo; optional if one was already uploaded.")
    remarks = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ResolutionImageUploadSerializer(serializers.Serializer):
    image = serializers.FileField()


class OfficerDetailSerializer(OfficerSummarySerializer):
    """OfficerSummarySerializer plus the department the officer belongs to."""

    department = serializers.SerializerMethodField()

    class Meta(OfficerSummarySerializer.Meta):
        fields = OfficerSummarySerializer.Meta.fields + ["department"]
        read_only_fields = fields

    def get_department(self, obj) -> dict:
        d = obj.department
        return {"id": str(d.id), "name": d.name, "city": d.city, "is_active": d.is_active}


class OfficerCreateSerializer(RegisterSerializer):
    """Admin creates an officer account. Email and password rules are inherited from
    RegisterSerializer (case-insensitive duplicate-email check, password strength validators),
    so they cannot drift from public registration. Role is never an input."""

    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all())
    employee_reference = serializers.CharField(max_length=50)

    class Meta(RegisterSerializer.Meta):
        fields = ["email", "full_name", "password", "department", "employee_reference"]

    def validate_department(self, department):
        if not department.is_active:
            raise serializers.ValidationError("This department is not active.")
        return department

    def validate_employee_reference(self, value):
        if OfficerProfile.objects.filter(employee_reference__iexact=value).exists():
            raise serializers.ValidationError("An officer with this employee reference already exists.")
        return value

    def create(self, validated_data):
        from . import services

        return services.create_officer(**validated_data)
