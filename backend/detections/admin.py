from django.contrib import admin
from .models import DetectionJob

@admin.register(DetectionJob)
class DetectionJobAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "progress", "confidence", "created_at")
    search_fields = ("id",)
