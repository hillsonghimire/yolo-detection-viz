from rest_framework import serializers
from .models import DetectionJob

class DetectionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetectionJob
        fields = ["id", "image", "status", "result", "created_at"]

class DetectRequestSerializer(serializers.Serializer):
    image = serializers.ImageField()
    confidence = serializers.FloatField(default=0.25, min_value=0.0, max_value=1.0)
    model = serializers.CharField(required=True) # Add this line

# New serializer for bulk uploads
class BulkDetectRequestSerializer(serializers.Serializer):
    images = serializers.ListField(
        child=serializers.ImageField(),
        min_length=1
    )
    confidence = serializers.FloatField(default=0.25, min_value=0.0, max_value=1.0)
    model = serializers.CharField(required=True) # Add this line