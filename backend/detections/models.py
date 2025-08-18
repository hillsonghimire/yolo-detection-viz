import uuid
from django.db import models

class DetectionJob(models.Model):
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("PROCESSING", "Processing"),
        ("DONE", "Done"),
        ("FAILED", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ImageField(upload_to="uploads/")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    progress = models.IntegerField(default=0)
    confidence = models.FloatField(default=0.25)
    result = models.JSONField(null=True, blank=True)
    labels_file = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.id} - {self.status}"
