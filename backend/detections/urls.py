# detections/urls.py
from django.urls import path
from .views import (
    BasicDetectView, 
    LargeDetectView, 
    BulkDetectView, 
    ListJobsView, 
    BulkJobsView, # Import the new BulkJobsView class
    DownloadLabelsView, 
    DownloadAnnotatedImageView,
    DownloadExcelView,
    HealthView,
)

urlpatterns = [
    path("detect/basic/", BasicDetectView.as_view(), name="detect-basic"),
    path("detect/large/", LargeDetectView.as_view(), name="detect-large"),
    path("detect/bulk/", BulkDetectView.as_view(), name="detect-bulk"),
    path("jobs/", ListJobsView.as_view(), name="jobs"),
    
    # NEW: URL for bulk jobs list
    path("bulk_jobs/", BulkJobsView.as_view(), name="bulk-jobs"),
    
    path("download/<str:fname>", DownloadLabelsView.as_view(), name="download-labels"),
    path("download/image/<str:fname>", DownloadAnnotatedImageView.as_view(), name="download-image"),
    path("download/excel/<str:fname>", DownloadExcelView.as_view(), name="download-excel"), # Point to the new view
    path("health/", HealthView.as_view(), name="health"),
]
