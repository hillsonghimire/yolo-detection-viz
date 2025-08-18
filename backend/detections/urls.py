from django.urls import path
from .views import BasicDetectView, LargeDetectView, ListJobsView, DownloadLabelsView

urlpatterns = [
    path("detect/basic/", BasicDetectView.as_view(), name="detect-basic"),
    path("detect/large/", LargeDetectView.as_view(), name="detect-large"),
    path("jobs/", ListJobsView.as_view(), name="jobs"),
    
    # download/<uuid>.txt
    path("download/<str:fname>", DownloadLabelsView.as_view(), name="download-labels"),

]
