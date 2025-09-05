from django.urls import path
from .views import BasicDetectView, LargeDetectView, BulkDetectView, ListJobsView, DownloadLabelsView, DownloadAnnotatedImageView

urlpatterns = [
    path("detect/basic/", BasicDetectView.as_view(), name="detect-basic"),
    path("detect/large/", LargeDetectView.as_view(), name="detect-large"),
    path("detect/bulk/", BulkDetectView.as_view(), name="detect-bulk"),
    path("jobs/", ListJobsView.as_view(), name="jobs"),
    
    # download/<uuid>.txt
    path("download/<str:fname>", DownloadLabelsView.as_view(), name="download-labels"),
     # download annotated image
    path("download/image/<str:fname>", DownloadAnnotatedImageView.as_view(), name="download-image"),
]