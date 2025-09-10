# detections/serializers.py
from rest_framework import serializers
from .models import DetectionJob, BulkDetectionJob
from typing import Any
import json

class DetectionJobSerializer(serializers.ModelSerializer):
    detection_count = serializers.SerializerMethodField()

    class Meta:
        model = DetectionJob
        fields = ["id", "image", "status", "progress", "confidence", "result", "created_at", "labels_file", "annotated_image", "detection_count"]
    
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
    
class BulkDetectionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = BulkDetectionJob
        fields = ["id", "status", "created_at", "excel_file"]