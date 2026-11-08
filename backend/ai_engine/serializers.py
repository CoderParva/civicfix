from rest_framework import serializers

from issues.models import IssueCategory

from .models import AIAnalysis


class DuplicateCheckSerializer(serializers.Serializer):
    """Either the fields of a draft report (citizens, before submitting) or an existing issue_id (admins)."""

    issue_id = serializers.UUIDField(required=False)
    latitude = serializers.FloatField(min_value=-90, max_value=90, required=False)
    longitude = serializers.FloatField(min_value=-180, max_value=180, required=False)
    title = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    category = serializers.PrimaryKeyRelatedField(queryset=IssueCategory.objects.filter(is_active=True), required=False)

    def validate(self, attrs):
        if "issue_id" not in attrs and ("latitude" not in attrs or "longitude" not in attrs):
            raise serializers.ValidationError("Provide latitude and longitude (or an issue_id).")
        return attrs


class PriorityRequestSerializer(serializers.Serializer):
    issue_id = serializers.UUIDField(required=False)
    category = serializers.PrimaryKeyRelatedField(queryset=IssueCategory.objects.filter(is_active=True), required=False)
    title = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    votes = serializers.IntegerField(min_value=0, max_value=100000, required=False, default=0)

    def validate(self, attrs):
        if "issue_id" not in attrs and "category" not in attrs:
            raise serializers.ValidationError("Provide a category (or an issue_id).")
        return attrs


class AIAnalysisSerializer(serializers.ModelSerializer):
    issue_id = serializers.UUIDField(read_only=True)
    reported_category = serializers.CharField(source="issue.category.name", read_only=True)

    class Meta:
        model = AIAnalysis
        fields = [
            "id",
            "issue_id",
            "reported_category",
            "processing_status",
            "model_name",
            "model_version",
            "predicted_category",
            "confidence",
            "duplicate_score",
            "suggested_priority",
            "result",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


def not_analyzed(issue):
    """The shape of an analysis for an issue that has none (created before Phase 7, or the helpers never ran)."""
    return {
        "id": None,
        "issue_id": str(issue.pk),
        "reported_category": issue.category.name,
        "processing_status": "not_analyzed",
        "model_name": "",
        "model_version": "",
        "predicted_category": "",
        "confidence": None,
        "duplicate_score": None,
        "suggested_priority": "",
        "result": {},
        "created_at": None,
        "updated_at": None,
    }
