from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class UserSerializer(serializers.ModelSerializer):
    """Profile representation. id, email, role and created_at are read-only."""

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "phone_number", "city", "state", "created_at"]
        read_only_fields = ["id", "email", "role", "created_at"]


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = ["email", "full_name", "password", "phone_number", "city", "state"]
        # Declared explicitly so the model-level UniqueValidator (case-sensitive)
        # doesn't run; validate_email below does the case-insensitive check.
        extra_kwargs = {"email": {"validators": []}}

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        # Unsaved user lets UserAttributeSimilarityValidator compare email/name to the password.
        candidate = User(email=attrs.get("email"), full_name=attrs.get("full_name", ""))
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        # Role is never client-controlled: public registration always creates a citizen.
        return User.objects.create_user(role=User.Role.CITIZEN, **validated_data)


class LoginSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["email"] = user.email
        return token

    def validate(self, attrs):
        attrs["email"] = str(attrs.get("email", "")).strip().lower()
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
