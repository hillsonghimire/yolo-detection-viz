# detections/serializers.py
from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import DetectionJob, BulkDetectionJob, UserProfile
from typing import Any
import json

class DetectionJobSerializer(serializers.ModelSerializer):
    detection_count = serializers.SerializerMethodField()

    class Meta:
        model = DetectionJob
        fields = [
            "id",
            "image",
            "status",
            "progress",
            "confidence",
            "result",
            "created_at",
            "labels_file",
            "annotated_image",
            "detection_count",
            "owner",
        ]
    
    def get_detection_count(self, obj: Any) -> int:
        if obj.result:
            try:
                result_data = json.loads(obj.result)
                return result_data.get("detection_count", 0)
            except (json.JSONDecodeError, TypeError):
                return 0
        return 0

class DetectRequestSerializer(serializers.Serializer):
    image = serializers.ImageField()
    confidence = serializers.FloatField(default=0.25, min_value=0.0, max_value=1.0)
    model = serializers.CharField(required=True)

class BulkDetectRequestSerializer(serializers.Serializer):
    images = serializers.ListField(
        child=serializers.ImageField(),
        min_length=1
    )
    confidence = serializers.FloatField(default=0.25, min_value=0.0, max_value=1.0)
    model = serializers.CharField(required=True)
    # Optional kernel measurement parameters (used when model == "kernel")
    sidemm = serializers.FloatField(required=False, default=40.0, min_value=0.1)
    allowed_ids = serializers.CharField(required=False, default="425,100,201,310")
    use_sam = serializers.BooleanField(required=False, default=False)
    sam_checkpoint = serializers.CharField(required=False, allow_blank=True, default="")
    sam_model_type = serializers.ChoiceField(required=False, choices=["vit_b", "vit_l", "vit_h"], default="vit_b")
    # Optional stomata pipeline parameters (used when model == "stomata")
    um_per_px = serializers.FloatField(required=False, default=0.3448275862, min_value=0.000001)
    iou = serializers.FloatField(required=False, default=0.7, min_value=0.0, max_value=1.0)
    
class BulkDetectionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = BulkDetectionJob
        fields = ["id", "status", "created_at", "excel_file", "owner"]


class KernelMeasureRequestSerializer(serializers.Serializer):
    image = serializers.ImageField()
    # The YOLO model key to use (from detect_models.MODEL_REGISTRY)
    model = serializers.CharField(required=False, default="kernel")
    # ArUco marker physical side length in millimeters
    sidemm = serializers.FloatField(required=True, min_value=0.1)
    # Allowed ArUco IDs, as a comma-separated string like "0,1,2,3"
    allowed_ids = serializers.CharField(required=False, default="425,100,201,310")
    # Optional SAM refinement
    use_sam = serializers.BooleanField(required=False, default=False)
    sam_checkpoint = serializers.CharField(required=False, allow_blank=True, default="")
    sam_model_type = serializers.ChoiceField(required=False, choices=["vit_b", "vit_l", "vit_h"], default="vit_b")


class StomataMeasureRequestSerializer(serializers.Serializer):
    image = serializers.ImageField()
    um_per_px = serializers.FloatField(required=False, default=0.3448275862, min_value=0.000001)
    conf = serializers.FloatField(required=False, default=0.25, min_value=0.0, max_value=1.0)
    iou = serializers.FloatField(required=False, default=0.7, min_value=0.0, max_value=1.0)
    sam_checkpoint = serializers.CharField(required=False, allow_blank=True, default="")
    sam_model_type = serializers.ChoiceField(required=False, choices=["vit_b", "vit_l", "vit_h"], default="vit_b")


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ["id", "username", "email", "first_name", "last_name"]


class RegistrationSerializer(serializers.Serializer):
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    username = serializers.CharField()
    email = serializers.EmailField()
    organization = serializers.CharField()
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True, min_length=8)


class EmailVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    otp_code = serializers.CharField(required=False, allow_blank=True)
    token = serializers.CharField(required=False, allow_blank=True)


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ["organization", "email_verified"]
