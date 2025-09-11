# detections/views.py
import os
import io
import tempfile
from typing import Dict, Any, List, Tuple

from django.db import transaction
from django.conf import settings
from django.http import FileResponse, Http404
from django.core.files.storage import default_storage
from django.shortcuts import get_object_or_404

from PIL import Image
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics, serializers
from rest_framework.parsers import MultiPartParser, FormParser
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample, OpenApiResponse, OpenApiTypes

from celery import chord, group

from .models import DetectionJob, BulkDetectionJob
from .serializers import DetectionJobSerializer, DetectRequestSerializer, BulkDetectRequestSerializer, BulkDetectionJobSerializer
from .tasks import run_large_detection, generate_excel_report
from .detect_models import run_inference


# ---------- helpers ----------
def _aabb_from_obb_polygon(pts: List[float]) -> Tuple[int, int, int, int]:
    xs = pts[0::2]
    ys = pts[1::2]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))


def _image_dims(image_path: str) -> Tuple[int, int]:
    try:
        with Image.open(image_path) as im:
            return im.width, im.height
    except Exception:
        return 0, 0

class BasicDetectView(APIView):
    # ... (rest of BasicDetectView is unchanged)
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Run detection with selected model (single request)",
        description=(
            "Upload an image once (low conf) and receive the full set of detections. "
            "Your frontend then filters overlays live with a confidence slider (no extra backend calls)."
        ),
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {
                    "image": {"type": "string", "format": "binary", "description": "Image file (preferred key)"},
                    "file":  {"type": "string", "format": "binary", "description": "Alternate key for image"},
                    "model": {"type": "string", "enum": ["spike", "spikelet", "fhb", "fdk"], "default": "spike"},
                    "conf":  {"type": "number", "default": 0.05, "description": "Server-side min confidence (keep low)"},
                },
                "required": ["image"]
            }
        },
        responses={
            200: OpenApiResponse(
                response={
                    "type": "object",
                    "properties": {
                        "image_width": {"type": "integer", "example": 1920},
                        "image_height": {"type": "integer", "example": 1080},
                        "detections": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "class": {"type": "string", "example": "0"},
                                    "class_id": {"type": "integer", "nullable": True, "example": 0},
                                    "confidence": {"type": "number", "example": 0.91},
                                    "poly": {
                                        "type": "array",
                                        "items": {"type": "number"},
                                        "example": [100,200, 300,200, 300,400, 100,400]
                                    }
                                }
                            }
                        }
                    }
                },
                description="Full detection set (OBB polygons if available)."
            ),
            400: OpenApiResponse(description="Bad request (missing file or invalid params)"),
            404: OpenApiResponse(description="Model weights not found"),
            500: OpenApiResponse(description="Inference error"),
        },
        examples=[
            OpenApiExample(
                "Response example",
                value={
                    "image_width": 1024,
                    "image_height": 768,
                    "detections": [
                        {"class": "0", "class_id": 0, "confidence": 0.88, "poly": [100,100, 200,100, 200,180, 100,180]},
                        {"class": "0", "class_id": 0, "confidence": 0.32, "poly": [300,220, 380,210, 390,290, 310,300]},
                    ],
                },
            )
        ],
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        up = request.FILES.get("image") or request.FILES.get("file")
        if not up:
            return Response({"detail": "No file uploaded (expected 'image' or 'file')."}, status=400)

        model_name = (request.data.get("model") or "spike").strip()
        try:
            conf = float(request.data.get("conf", 0.05))
        except (ValueError, TypeError):
            conf = 0.05

        try:
            image = Image.open(io.BytesIO(up.read())).convert("RGB")
        except Exception as e:
            return Response({"detail": f"Invalid image: {e}"}, status=400)

        try:
            payload = run_inference(model_name, image, conf=conf)
        except FileNotFoundError as e:
            return Response({"detail": str(e)}, status=404)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        except Exception as e:
            return Response({"detail": f"Inference error: {e}"}, status=500)

        return Response(payload, status=200)

class HealthView(APIView):
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="Health check",
        description="Lightweight GET to verify the API is reachable.",
        responses={200: OpenApiResponse(description="OK")},
        tags=["System"],
    )
    def get(self, request, *args, **kwargs):
        return Response({"status": "ok"}, status=200)

class LargeDetectView(APIView):
    # ... (content of LargeDetectView is unchanged)
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Submit async object detection job",
        description="""
        Submit an image for asynchronous processing using Celery workers.
        Ideal for large images or when processing multiple images concurrently.
        Returns a job ID that can be used to check processing status.
        """,
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'image': {
                        'type': 'string',
                        'format': 'binary',
                        'description': 'Image file to process (supports JPG, PNG, JPEG)'
                    },
                    'confidence': {
                        'type': 'number',
                        'format': 'float',
                        'minimum': 0.0,
                        'maximum': 1.0,
                        'default': 0.25,
                        'description': 'Confidence threshold for detections'
                    }
                },
                'required': ['image']
            }
        },
        responses={
            202: OpenApiResponse(
                response={
                    'type': 'object',
                    'properties': {
                        'unique_id': {'type': 'string', 'format': 'uuid', 'example': '123e4567-e89b-12d3-a456-426614174000'},
                        'success': {'type': 'boolean', 'example': True},
                        'message': {'type': 'string', 'example': 'Job submitted successfully'}
                    }
                },
                description='Job successfully submitted for async processing'
            ),
            400: OpenApiResponse(description='Bad request - missing image or invalid parameters')
        },
        examples=[
            OpenApiExample(
                'Job submission success',
                summary='Successful job submission',
                value={
                    'unique_id': '123e4567-e89b-12d3-a456-426614174000',
                    'success': True,
                    'message': 'Job submitted successfully'
                }
            )
        ],
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        s = DetectRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        if "image" not in request.FILES:
            return Response({"detail": "image file is required"}, status=400)

        image = request.FILES["image"]
        confidence = float(s.validated_data.get("confidence", 0.25))
        model_name = s.validated_data.get("model", "spike")

        job = DetectionJob.objects.create(
            image=image,
            confidence=confidence,
            status="QUEUED",
            progress=0,
        )

        image_path = job.image.path
        # Pass model_name to task to match signature
        run_large_detection.delay(str(job.id), image_path, confidence, model_name)

        return Response(
            {"unique_id": str(job.id), "success": True},
            status=status.HTTP_202_ACCEPTED,
        )

class BulkDetectView(APIView):
    # ... (content of BulkDetectView remains unchanged)
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Submit multiple images for async processing",
        description="""
        Submit multiple images at once for asynchronous processing.
        Returns a list of job IDs, one for each image.
        """,
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {
                    "images": {
                        "type": "array",
                        "items": {"type": "string", "format": "binary"}
                    },
                    "confidence": {
                        "type": "number",
                        "default": 0.25,
                        "description": "Confidence threshold for detections"
                    },
                    "model": {"type": "string", "enum": ["spike", "spikelet", "fhb", "fdk", "third"], "default": "spike"},
                },
                "required": ["images", "model"]
            }
        },
        responses={
            202: OpenApiResponse(
                response={
                    'type': 'object',
                    'properties': {
                        'job_ids': {'type': 'array', 'items': {'type': 'string', 'format': 'uuid'}},
                        'message': {'type': 'string', 'example': 'Bulk job submitted successfully'}
                    }
                },
                description='Jobs successfully submitted for async processing'
            ),
            400: OpenApiResponse(description='Bad request - missing images or invalid parameters')
        },
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        serializer = BulkDetectRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        images = request.FILES.getlist('images')
        confidence = serializer.validated_data.get('confidence', 0.25)
        model_name = serializer.validated_data.get('model', 'spike')

        if not images:
            return Response({"detail": "No images provided."}, status=status.HTTP_400_BAD_REQUEST)

        bulk_job = BulkDetectionJob.objects.create(status="PENDING")
        
        tasks = []
        with transaction.atomic():
            for image_file in images:
                job = DetectionJob.objects.create(
                    image=image_file,
                    confidence=confidence,
                    status="QUEUED",
                    progress=0,
                )
                bulk_job.jobs.add(job)
                tasks.append(run_large_detection.s(str(job.id), job.image.path, confidence, model_name))

        # Mark bulk job as processing while individual jobs run
        bulk_job.status = "PROCESSING"
        bulk_job.save(update_fields=["status"])

        # Use immutable signature so Celery does not prepend header results
        callback = generate_excel_report.si(str(bulk_job.id))
        chord(group(tasks), callback).apply_async()

        return Response(
            {"bulk_job_id": str(bulk_job.id), "message": "Bulk job submitted successfully"},
            status=status.HTTP_202_ACCEPTED
        )

class BulkJobsView(generics.ListAPIView):
    """List all bulk detection jobs."""
    serializer_class = BulkDetectionJobSerializer
    queryset = BulkDetectionJob.objects.all().order_by("-created_at")

class ListJobsView(generics.ListAPIView):
    """List all individual detection jobs with filtering and pagination support."""
    serializer_class = DetectionJobSerializer
    queryset = DetectionJob.objects.all().order_by("-created_at")

class DownloadAnnotatedImageView(APIView):
    # ... (content of DownloadAnnotatedImageView is unchanged)
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="Download annotated image with bounding boxes",
        description="""
        Downloads the processed image with bounding boxes drawn on it.
        """,
        parameters=[
            OpenApiParameter(
                name='fname',
                type=OpenApiTypes.STR,
                location=OpenApiParameter.PATH,
                description='Filename of the annotated image to download (must end with .jpg)'
            )
        ],
        responses={
            200: OpenApiResponse(
                response={'type': 'string', 'format': 'binary'},
                description='JPEG image with detection bounding boxes'
            ),
            404: OpenApiResponse(description='File not found')
        },
        tags=["Detection"],
    )
    def get(self, request, fname: str):
        # accept uppercase/lowercase extensions
        import os
        ext = os.path.splitext(fname)[1].lower()
        if ext not in (".jpg", ".jpeg"):
            raise Http404()
        
        rel = f"annotated/{fname}"
        path = (
            default_storage.path(rel)
            if hasattr(default_storage, "path")
            else os.path.join(settings.MEDIA_ROOT, rel)
        )
        if not os.path.exists(path):
            raise Http404()
        
        return FileResponse(open(path, "rb"), as_attachment=True, filename=fname, content_type="image/jpeg")

class DownloadLabelsView(APIView):
        # ... (content of DownloadLabelsView is unchanged)
    authentication_classes = [] 
    permission_classes = []

    @extend_schema(
        summary="Download detection labels file",
        description="""
        Download the generated labels file containing detection results in plain text format.
        Each line contains: class_name\tconfidence\tx1,y1,x2,y2
        """,
        parameters=[
            OpenApiParameter(
                name='fname',
                type=OpenApiTypes.STR,
                location=OpenApiParameter.PATH,
                description='Filename of the labels file to download (must end with .txt)'
            )
        ],
        responses={
            200: OpenApiResponse(
                response={'type': 'string', 'format': 'binary'},
                description='Plain text file containing detection results'
            ),
            404: OpenApiResponse(description='File not found')
        },
        tags=["Detection"],
    )
    def get(self, request, fname: str):
        # accept uppercase/lowercase extensions
        if not fname.lower().endswith(".txt"):
            raise Http404()
        rel = f"labels/{fname}"
        path = (
            default_storage.path(rel)
            if hasattr(default_storage, "path")
            else os.path.join(settings.MEDIA_ROOT, rel)
        )
        if not os.path.exists(path):
            raise Http404()
        return FileResponse(open(path, "rb"), as_attachment=True, filename=fname, content_type="text/plain")
    
class DownloadExcelView(APIView):
    """
    GET /download/excel/<uuid>_report.xlsx
    Streams the generated Excel file.
    """
    authentication_classes = []
    permission_classes = []

    @extend_schema(
        summary="Download bulk processing Excel report",
        description="""
        Downloads the Excel file containing the aggregated detection counts for a bulk job.
        """,
        parameters=[
            OpenApiParameter(
                name='fname',
                type=OpenApiTypes.STR,
                location=OpenApiParameter.PATH,
                description='Filename of the Excel file to download (e.g., <uuid>_report.xlsx)'
            )
        ],
        responses={
            200: OpenApiResponse(
                response={'type': 'string', 'format': 'binary'},
                description='Excel file containing detection statistics'
            ),
            404: OpenApiResponse(description='File not found')
        },
        tags=["Detection"],
    )
    def get(self, request, fname: str):
        if not fname.lower().endswith(".xlsx"):
            raise Http404("Invalid file extension.")
        
        rel_path = f"reports/{fname}"
        abs_path = os.path.join(settings.MEDIA_ROOT, rel_path)
        
        if not os.path.exists(abs_path):
            raise Http404("File not found.")
        
        return FileResponse(
            open(abs_path, "rb"),
            as_attachment=True,
            filename=fname,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
