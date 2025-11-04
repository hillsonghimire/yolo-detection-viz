# detections/urls.py
from django.urls import path
from .views import (
    BasicDetectView, 
    LargeDetectView, 
    BulkDetectView, 
    ListJobsView, 
    BulkJobsView, # Import the new BulkJobsView class
    JobDetailView,
    DownloadLabelsView, 
    DownloadAnnotatedImageView,
    DownloadExcelView,
    HealthView,
    KernelMeasureView,
    DownloadMeasureImageView,
    DownloadMeasureCSVView,
)

urlpatterns = [
    path("detect/basic/", BasicDetectView.as_view(), name="detect-basic"),
    path("detect/large/", LargeDetectView.as_view(), name="detect-large"),
    path("detect/bulk/", BulkDetectView.as_view(), name="detect-bulk"),
    path("jobs/", ListJobsView.as_view(), name="jobs"),
    path("jobs/<uuid:id>/", JobDetailView.as_view(), name="job-detail"),
    
    # NEW: URL for bulk jobs list
    path("bulk_jobs/", BulkJobsView.as_view(), name="bulk-jobs"),
    
    path("download/<str:fname>", DownloadLabelsView.as_view(), name="download-labels"),
    path("download/image/<str:fname>", DownloadAnnotatedImageView.as_view(), name="download-image"),
    path("download/excel/<str:fname>", DownloadExcelView.as_view(), name="download-excel"), # Point to the new view
    path("download/measure/image/<str:fname>", DownloadMeasureImageView.as_view(), name="download-measure-image"),
    path("download/measure/csv/<str:fname>", DownloadMeasureCSVView.as_view(), name="download-measure-csv"),
    path("health/", HealthView.as_view(), name="health"),
    path("measure/kernel/", KernelMeasureView.as_view(), name="measure-kernel"),
]
