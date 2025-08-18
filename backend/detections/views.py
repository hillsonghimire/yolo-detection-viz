import os
import tempfile
from typing import Dict, Any, List, Tuple

from django.db import transaction
from django.conf import settings
from django.http import FileResponse, Http404
from django.core.files.storage import default_storage

from PIL import Image
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics
from rest_framework.parsers import MultiPartParser, FormParser  # REQUIRED
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample, OpenApiResponse
from drf_spectacular.types import OpenApiTypes

from .models import DetectionJob
from .serializers import DetectionJobSerializer, DetectRequestSerializer
from .inference import run_detection
from .tasks import run_large_detection


# ---------- helpers ----------
def _write_labels_txt(detections: List[Dict[str, Any]]) -> bytes:
    """
    Plain-text artifact. One line per detection:
    class_name\tconfidence\tx1,y1,x2,y2
    (If OBB is present we emit polygon too as x1,y1,...,x4,y4 after the AABB.)
    """
    lines = []
    for d in detections:
        cname = d.get("class_name", str(d.get("class_id", "?")))
        conf = float(d.get("confidence", 0.0))
        if "bbox_xyxy" in d:  # axis-aligned
            x1, y1, x2, y2 = d["bbox_xyxy"]
            lines.append(f"{cname}\t{conf:.6f}\t{x1},{y1},{x2},{y2}")
        elif "bbox_xyxyxyxy" in d:  # OBB polygon
            pts = d["bbox_xyxyxyxy"]
            xs = pts[0::2]
            ys = pts[1::2]
            x1, x2 = int(min(xs)), int(max(xs))
            y1, y2 = int(min(ys)), int(max(ys))
            poly = ",".join(str(int(v)) for v in pts)
            lines.append(f"{cname}\t{conf:.6f}\t{x1},{y1},{x2},{y2}\t{poly}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def _aabb_from_obb_polygon(pts: List[float]) -> Tuple[int, int, int, int]:
    """Given 8 numbers [x1,y1,x2,y2,x3,y3,x4,y4], return axis-aligned (x1,y1,x2,y2) ints."""
    xs = pts[0::2]
    ys = pts[1::2]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))


def _image_dims(image_path: str) -> Tuple[int, int]:
    """Return (width,height) using PIL, falling back to (0,0) on error."""
    try:
        with Image.open(image_path) as im:
            return im.width, im.height
    except Exception:
        return 0, 0


# ---------- API views ----------
class BasicDetectView(APIView):
    """
    Synchronous detection endpoint for real-time object detection.
    """
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Perform synchronous object detection",
        description="""
        Upload an image and get immediate detection results.
        Supports both axis-aligned bounding boxes and oriented bounding boxes (OBB).
        """,
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'image': {
                        'type': 'string',
                        'format': 'binary',
                        'description': 'Image file to analyze (JPG, PNG, JPEG supported)'
                    },
                    'confidence': {
                        'type': 'number',
                        'format': 'float',
                        'minimum': 0.0,
                        'maximum': 1.0,
                        'default': 0.25,
                        'description': 'Confidence threshold for detections (0.0-1.0)'
                    }
                },
                'required': ['image']
            }
        },
        responses={
            200: OpenApiResponse(
                response={
                    'type': 'object',
                    'properties': {
                        'success': {'type': 'boolean', 'example': True},
                        'detection_count': {'type': 'integer', 'example': 3},
                        'detections': {
                            'type': 'array',
                            'items': {
                                'type': 'object',
                                'properties': {
                                    'class_name': {'type': 'string', 'example': 'wheat_spike'},
                                    'confidence': {'type': 'number', 'example': 0.95},
                                    'bbox_xyxy': {
                                        'type': 'array',
                                        'items': {'type': 'number'},
                                        'example': [100, 200, 300, 400]
                                    },
                                    'bbox_xyxyxyxy': {
                                        'type': 'array',
                                        'items': {'type': 'number'},
                                        'example': [100, 200, 300, 200, 300, 400, 100, 400]
                                    }
                                }
                            }
                        },
                        'image_width': {'type': 'integer', 'example': 1920},
                        'image_height': {'type': 'integer', 'example': 1080}
                    }
                },
                description='Detection results with bounding boxes and confidence scores'
            ),
            400: OpenApiResponse(description='Bad request - missing image or invalid parameters')
        },
        examples=[
            OpenApiExample(
                'Successful detection',
                summary='Example detection response',
                value={
                    'success': True,
                    'detection_count': 2,
                    'detections': [
                        {
                            'class_name': 'wheat_spike',
                            'confidence': 0.95,
                            'bbox_xyxy': [100, 200, 300, 400]
                        },
                        {
                            'class_name': 'wheat_spike',
                            'confidence': 0.87,
                            'bbox_xyxy': [500, 600, 700, 800]
                        }
                    ],
                    'image_width': 1920,
                    'image_height': 1080
                }
            )
        ]
    )
    def post(self, request, *args, **kwargs):
        # Handle both frontend field names: "file" and "image"
        confidence = 0.25
        if "conf" in request.data:
            try:
                confidence = float(request.data["conf"])
            except (ValueError, TypeError):
                confidence = 0.25
        
        # Accept both "file" (frontend) and "image" (backend) field names
        image_file = None
        if "file" in request.FILES:
            image_file = request.FILES["file"]
        elif "image" in request.FILES:
            image_file = request.FILES["image"]
        
        if not image_file:
            return Response({"detail": "image file is required"}, status=400)
        
        image = image_file

        # write to a temp file so Ultralytics can read it
        suffix = os.path.splitext(getattr(image, "name", ""))[-1] or ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            for chunk in image.chunks():
                tmp.write(chunk)
            tmp_path = tmp.name

        try:
            # Your simplified OBB-only inference (returns detections, meta)
            detections, meta = run_detection(tmp_path, confidence=confidence)
            payload = {
                "success": True,
                "detection_count": len(detections),
                "detections": detections,
                "image_width": meta.get("image_width"),
                "image_height": meta.get("image_height"),
            }
            return Response(payload, status=status.HTTP_200_OK)
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass

class LargeDetectView(APIView):
    """
    Async (Celery) detection endpoint for processing large images or batch processing.
    """
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
        ]
    )
    def post(self, request, *args, **kwargs):
        # Reuse the same serializer; ensure it accepts both `confidence` and `image`
        s = DetectRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        if "image" not in request.FILES:
            return Response({"detail": "image file is required"}, status=400)

        image = request.FILES["image"]
        confidence = float(s.validated_data.get("confidence", 0.25))

        # Persist the upload via the model so we have a stable path
        job = DetectionJob.objects.create(
            image=image,
            confidence=confidence,
            status="QUEUED",
            progress=0,
        )

        # Use the stored file path (served by MEDIA_ROOT) for the worker
        image_path = job.image.path  # should exist once saved
        # Call Celery task with correct signature: (job_id, image_path, confidence)
        run_large_detection.delay(str(job.id), image_path, confidence)

        return Response(
            {"unique_id": str(job.id), "success": True},
            status=status.HTTP_202_ACCEPTED,
        )


class ListJobsView(generics.ListAPIView):
    """List all detection jobs with filtering and pagination support."""
    serializer_class = DetectionJobSerializer
    queryset = DetectionJob.objects.all().order_by("-created_at")


class DownloadLabelsView(APIView):
    """
    GET /download/<uuid>.txt
    Streams the labels file from MEDIA_ROOT/labels/
    """
    authentication_classes = []  # public like the reference site
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
        }
    )
    def get(self, request, fname: str):
        # secure: allow only .txt filenames (uuid.txt)
        if not fname.endswith(".txt"):
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
