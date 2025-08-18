from rest_framework import serializers
from .models import DetectionJob

class DetectionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetectionJob
        fields = ["id", "image", "status", "result", "created_at"]

class DetectRequestSerializer(serializers.Serializer):
    image = serializers.ImageField()
    confidence = serializers.FloatField(default=0.25, min_value=0.0, max_value=1.0)
