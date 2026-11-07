from rest_framework import serializers

from .models import ContentReport, Issue, IssueCategory, IssueComment, IssueImage


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueCategory
        fields = ["id", "name", "icon"]


class IssueImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = IssueImage
        fields = ["id", "url", "image_type", "uploaded_at"]

    def get_url(self, obj) -> str:
        request = self.context.get("request")
        return request.build_absolute_uri(obj.image_url) if request else obj.image_url


class IssueSerializer(serializers.ModelSerializer):
    """Read representation. Needs the annotations from selectors.annotate_issues().

    The reporter's identity is never exposed publicly; owners get `is_mine`, plus
    `moderation_status` / `is_public` for their own issues only.
    """

    category = CategorySerializer(read_only=True)
    location = serializers.SerializerMethodField()
    images = IssueImageSerializer(many=True, read_only=True)
    vote_count = serializers.IntegerField(read_only=True)
    comment_count = serializers.IntegerField(read_only=True)
    has_voted = serializers.BooleanField(read_only=True)
    is_following = serializers.BooleanField(read_only=True)
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = [
            "id", "reference_number", "title", "description", "category", "status", "priority",
            "location", "address", "landmark", "images", "vote_count", "comment_count",
            "has_voted", "is_following", "is_mine", "moderation_status", "is_public",
            "created_at", "resolved_at",
        ]
        read_only_fields = fields

    def get_location(self, obj) -> dict:
        return {"latitude": obj.location.y, "longitude": obj.location.x}

    def get_is_mine(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and obj.reporter_id == request.user.id)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data["is_mine"]:
            data.pop("moderation_status")
            data.pop("is_public")
        return data


class NearbyIssueSerializer(IssueSerializer):
    distance_m = serializers.SerializerMethodField()

    class Meta(IssueSerializer.Meta):
        fields = IssueSerializer.Meta.fields + ["distance_m"]
        read_only_fields = fields

    def get_distance_m(self, obj) -> float:
        return round(obj.distance.m, 1)


class IssueCreateSerializer(serializers.Serializer):
    """Only these inputs are accepted; status/priority/moderation/reporter are not fields at all."""

    category = serializers.PrimaryKeyRelatedField(queryset=IssueCategory.objects.filter(is_active=True))
    title = serializers.CharField(min_length=5, max_length=150)
    description = serializers.CharField(min_length=10, max_length=2000)
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    address = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    landmark = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class IssueUpdateSerializer(serializers.Serializer):
    """PATCH allow-list: title and description. Anything else is rejected, not silently ignored."""

    title = serializers.CharField(min_length=5, max_length=150, required=False)
    description = serializers.CharField(min_length=10, max_length=2000, required=False)

    def to_internal_value(self, data):
        extra = sorted(set(data) - set(self.fields))
        if extra:
            raise serializers.ValidationError({name: "This field cannot be edited." for name in extra})
        return super().to_internal_value(data)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide title and/or description.")
        return attrs


class ImageUploadSerializer(serializers.Serializer):
    image = serializers.FileField()


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="user.full_name", read_only=True)
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = IssueComment
        fields = ["id", "author_name", "content", "is_mine", "created_at"]
        read_only_fields = fields

    def get_is_mine(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and obj.user_id == request.user.id)


class CommentCreateSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=1000)


class ReportSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=ContentReport.Reason.choices)
    details = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class NearbyQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    radius = serializers.FloatField(min_value=1, max_value=20000, required=False, default=1000)
