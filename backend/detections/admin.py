from django.contrib import admin
from .models import DetectionJob, BulkDetectionJob

@admin.register(DetectionJob)
class DetectionJobAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "progress", "confidence", "created_at")
    search_fields = ("id",)

@admin.register(BulkDetectionJob)
class BulkDetectionJobAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "excel_file", "created_at")
    filter_horizontal = ("jobs",) # Allows for a nice interface to manage the ManyToMany field
    search_fields = ("id",)