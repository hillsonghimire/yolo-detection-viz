# detections/views.py  — FULL FILE REPLACEMENT
import os
import io
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
from rest_framework.parsers import MultiPartParser, FormParser
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample, OpenApiResponse
from drf_spectacular.types import OpenApiTypes

from .models import DetectionJob
from .serializers import DetectionJobSerializer, DetectRequestSerializer
from .tasks import run_large_detection

# 🔁 NEW: central inference import (bundled inside detections/)
from .detect_models import run_inference


# ---------- helpers ----------
def _write_labels_txt(detections: List[Dict[str, Any]]) -> bytes:
    """
    Plain-text artifact. One line per detection:
    class_name\tconfidence\tx1,y1,x2,y2
    (If OBB is present we emit polygon too as x1,y1,...,x4,y4 after the AABB.)
    """
    lines = []
    for d in detections:
        cname = d.get("class_name") or d.get("class") or str(d.get("class_id", "?"))
        conf = float(d.get("confidence", 0.0))
        if "bbox_xyxy" in d:  # axis-aligned (legacy shape)
            x1, y1, x2, y2 = d["bbox_xyxy"]
            lines.append(f"{cname}\t{conf:.6f}\t{x1},{y1},{x2},{y2}")
        elif "bbox_xyxyxyxy" in d:  # OBB polygon (legacy shape)
            pts = d["bbox_xyxyxyxy"]
            xs = pts[0::2]
            ys = pts[1::2]
            x1, x2 = int(min(xs)), int(max(xs))
            y1, y2 = int(min(ys)), int(max(ys))
            poly = ",".join(str(int(v)) for v in pts)
            lines.append(f"{cname}\t{conf:.6f}\t{x1},{y1},{x2},{y2}\t{poly}")
        elif "poly" in d:  # New normalized shape
            pts = d["poly"]
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
    Synchronous detection endpoint.
    Accepts multipart/form-data with:
      - image OR file: uploaded image
      - model: "spike" | "spikelet" | "fhb" | "fdk"
      - conf: float (low; the frontend filters client-side with the slider)
    Returns JSON:
      { image_width, image_height, detections: [{class, class_id, confidence, poly:[x1,y1,...,x4,y4]}] }
    """
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
        # Accept both "image" and "file"
        up = request.FILES.get("image") or request.FILES.get("file")
        if not up:
            return Response({"detail": "No file uploaded (expected 'image' or 'file')."}, status=400)

        model_name = (request.data.get("model") or "spike").strip()
        try:
            conf = float(request.data.get("conf", 0.05))
        except (ValueError, TypeError):
            conf = 0.05

        # Open as PIL and run inference
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
        ],
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        # Reuse your serializer for validation
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
        },
        tags=["Detection"],
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