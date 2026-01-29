import uuid
from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    organization = models.CharField(max_length=200)
    email_verified = models.BooleanField(default=False)
    verification_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    otp_code = models.CharField(max_length=10, blank=True, default="")
    otp_expires_at = models.DateTimeField(null=True, blank=True)
    verification_sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.user} profile"

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
    annotated_image = models.CharField(max_length=255, blank=True, default="")
    original_filename = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="detection_jobs", null=True, blank=True
    )

    def __str__(self):
        return f"{self.id} - {self.status}"

class BulkDetectionJob(models.Model):
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("PROCESSING", "Processing"),
        ("DONE", "Done"),
        ("FAILED", "Failed"),
    ]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    jobs = models.ManyToManyField(DetectionJob, related_name='bulk_job')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    excel_file = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bulk_jobs", null=True, blank=True
    )

    def __str__(self):
        return f"Bulk Job {self.id} - {self.status}"
