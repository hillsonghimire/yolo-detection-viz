# detections/views.py
import os
import io
import json
import uuid
import hashlib
import mimetypes
import random
from typing import Dict, Any, List, Optional, Tuple

from django.db import transaction
from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.contrib.auth import get_user_model

from PIL import Image
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics, serializers
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample, OpenApiResponse, OpenApiTypes

from celery import chord, group

from .models import DetectionJob, BulkDetectionJob, UserProfile
from .serializers import (
    DetectionJobSerializer,
    DetectRequestSerializer,
    BulkDetectRequestSerializer,
    BulkDetectionJobSerializer,
    KernelMeasureRequestSerializer,
    StomataMeasureRequestSerializer,
    RegistrationSerializer,
    EmailVerificationSerializer,
    UserSerializer,
    UserProfileSerializer,
)
from .tasks import run_large_detection, generate_excel_report, run_kernel_measurement, run_stomata_measurement
from .detect_models import run_inference
from .fhb_field_pipeline import run_fhb_field_pipeline
from .detection_cache import (
    load_detection_cache,
    store_detection_cache,
    sha256_bytes,
)
from .kernel_cache import (
    normalize_allowed_ids_csv,
    compute_kernel_params_hash,
    load_kernel_cache,
)
from .stomata_cache import (
    compute_stomata_params_hash,
    load_stomata_cache,
)


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


def _accessible_detection_jobs(user, include_public: bool = False):
    public_qs = DetectionJob.objects.filter(owner__isnull=True)
    if not user or user.is_anonymous:
        return public_qs if include_public else DetectionJob.objects.none()
    qs = DetectionJob.objects.filter(owner=user)
    if include_public:
        qs = qs | public_qs
    return qs


def _accessible_bulk_jobs(user):
    if not user or user.is_anonymous:
        return BulkDetectionJob.objects.none()
    return BulkDetectionJob.objects.filter(owner=user)


def _ensure_job_access_by_rel(user, rel_path: str, field: str):
    job = _accessible_detection_jobs(user, include_public=True).filter(**{field: rel_path}).first()
    if not job:
        raise Http404()
    return job


def _ensure_bulk_access_by_rel(user, rel_path: str, field: str):
    job = _accessible_bulk_jobs(user).filter(**{field: rel_path}).first()
    if not job:
        raise Http404()
    return job


def _ensure_measure_access(user, rel_path: str):
    jobs = _accessible_detection_jobs(user, include_public=True).filter(result__isnull=False)
    for job in jobs:
        payload = job.result
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                payload = None
        if isinstance(payload, dict):
            if payload.get("measurement_csv") == rel_path or payload.get("measurement_overlay") == rel_path:
                return job
    raise Http404()


def _ensure_media_access(user, rel_path: str):
    if rel_path.startswith("fhb_field/"):
        return None
    jobs = _accessible_detection_jobs(user, include_public=True)
    for job in jobs:
        if job.labels_file == rel_path or job.annotated_image == rel_path:
            return job
        payload = job.result
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                payload = None
        if isinstance(payload, dict):
            for value in payload.values():
                if value == rel_path:
                    return job
    raise Http404()


def _make_otp_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _build_verify_link(request, token: str) -> str:
    frontend_base = os.environ.get("FRONTEND_BASE_URL", "").strip()
    if frontend_base:
        return f"{frontend_base.rstrip('/')}/?verify={token}"
    return request.build_absolute_uri(f"/api/auth/verify/?token={token}")


def _send_verification_email(request, user, profile: UserProfile) -> str:
    otp = _make_otp_code()
    profile.otp_code = otp
    profile.otp_expires_at = timezone.now() + timezone.timedelta(minutes=15)
    profile.verification_token = uuid.uuid4()
    profile.verification_sent_at = timezone.now()
    profile.save(update_fields=["otp_code", "otp_expires_at", "verification_token", "verification_sent_at"])

    verify_link = _build_verify_link(request, str(profile.verification_token))
    subject = "WheatAI - Verify your email"
    message = (
        f"Hi {user.first_name},\n\n"
        f"Your verification code is: {otp}\n\n"
        f"Or click this link to verify your email:\n{verify_link}\n\n"
        "This code will expire in 15 minutes."
    )
    send_mail(
        subject,
        message,
        getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@wheatai.local"),
        [user.email],
        fail_silently=True,
    )
    return verify_link


def _authenticate_from_query(request):
    if request.user and not request.user.is_anonymous:
        return request.user
    token = (request.query_params.get("token") or "").strip()
    if not token:
        return None
    try:
        access = AccessToken(token)
        user_id = access.get("user_id")
        user = get_user_model().objects.get(id=user_id)
        request.user = user
        return user
    except Exception as exc:
        raise PermissionDenied("Invalid token.") from exc


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        s = RegistrationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        first_name = data["first_name"].strip()
        last_name = data["last_name"].strip()
        org_name = data["organization"].strip()
        if not first_name:
            raise ValidationError({"first_name": "First name is required."})
        if not last_name:
            raise ValidationError({"last_name": "Last name is required."})
        if not org_name:
            raise ValidationError({"organization": "Organization is required."})
        User = get_user_model()
        if data["password"] != data["confirm_password"]:
            raise ValidationError({"confirm_password": "Passwords do not match."})
        if User.objects.filter(username=data["username"]).exists():
            raise ValidationError({"username": "Username is already taken."})
        if User.objects.filter(email__iexact=data["email"]).exists():
            raise ValidationError({"email": "Email is already registered."})
        user = User.objects.create_user(
            username=data["username"],
            email=data["email"],
            password=data["password"],
            first_name=first_name,
            last_name=last_name,
            is_active=False,
        )
        profile = UserProfile.objects.create(
            user=user,
            organization=org_name,
            email_verified=False,
        )
        verify_link = _send_verification_email(request, user, profile)
        return Response(
            {
                "message": "Verification sent to your email.",
                "verification_link": verify_link,
            },
            status=status.HTTP_201_CREATED,
        )


class MeView(APIView):
    def get(self, request, *args, **kwargs):
        return Response(
            {
                "user": UserSerializer(request.user).data,
                "profile": UserProfileSerializer(request.user.profile).data if hasattr(request.user, "profile") else None,
            }
        )

class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        s = EmailVerificationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        token = (s.validated_data.get("token") or "").strip()
        otp_code = (s.validated_data.get("otp_code") or "").strip()
        email = (s.validated_data.get("email") or "").strip().lower()
        profile = None
        if token:
            profile = get_object_or_404(UserProfile, verification_token=token)
        elif otp_code and email:
            user = get_object_or_404(get_user_model(), email__iexact=email)
            profile = getattr(user, "profile", None)
        else:
            raise ValidationError("Provide token or email + otp_code.")

        if not profile:
            raise ValidationError("Invalid verification request.")
        if profile.email_verified:
            return Response({"message": "Email already verified."})
        if otp_code:
            if not profile.otp_code or otp_code != profile.otp_code:
                raise ValidationError({"otp_code": "Invalid OTP code."})
            if profile.otp_expires_at and profile.otp_expires_at < timezone.now():
                raise ValidationError({"otp_code": "OTP code has expired."})

        user = profile.user
        profile.email_verified = True
        profile.otp_code = ""
        profile.otp_expires_at = None
        profile.save(update_fields=["email_verified", "otp_code", "otp_expires_at"])
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])
        return Response({"message": "Email verified successfully."})

    def get(self, request, *args, **kwargs):
        token = (request.query_params.get("token") or "").strip()
        if not token:
            raise ValidationError({"token": "Token is required"})
        profile = get_object_or_404(UserProfile, verification_token=token)
        if profile.email_verified:
            return HttpResponse("Email already verified.")
        user = profile.user
        profile.email_verified = True
        profile.otp_code = ""
        profile.otp_expires_at = None
        profile.save(update_fields=["email_verified", "otp_code", "otp_expires_at"])
        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])
        return HttpResponse("Email verified successfully. You can close this window.")


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        s = EmailVerificationSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        email = (s.validated_data.get("email") or "").strip().lower()
        if not email:
            raise ValidationError({"email": "Email is required"})
        user = get_object_or_404(get_user_model(), email__iexact=email)
        profile = getattr(user, "profile", None)
        if not profile:
            raise ValidationError("Profile not found.")
        if profile.email_verified:
            return Response({"message": "Email already verified."})
        link = _send_verification_email(request, user, profile)
        return Response({"message": "Verification sent.", "verification_link": link})


class VerifiedTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        profile = getattr(user, "profile", None)
        if not user.is_active:
            raise ValidationError("Account is inactive. Verify your email first.")
        if profile and not profile.email_verified:
            raise ValidationError("Email is not verified.")
        return data


class VerifiedTokenObtainPairView(TokenObtainPairView):
    serializer_class = VerifiedTokenObtainPairSerializer

class BasicDetectView(APIView):
    permission_classes = [AllowAny]
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
                    "model": {"type": "string", "enum": ["spike", "spikelet", "kernel_count_on_spike", "fhb", "fdk", "kernel", "uav_spike", "stomata"], "default": "spike"},
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
        print("DEBUG: BasicDetectView.post called", flush=True)
        up = request.FILES.get("image") or request.FILES.get("file")
        if not up:
            return Response({"detail": "No file uploaded (expected 'image' or 'file')."}, status=400)

        model_name = (request.data.get("model") or "spike").strip()
        try:
            conf = float(request.data.get("conf", 0.05))
        except (ValueError, TypeError):
            conf = 0.05

        try:
            print("DEBUG: Reading file...", flush=True)
            raw_bytes = up.read()
            print(f"DEBUG: Read {len(raw_bytes)} bytes", flush=True)
        except Exception as e:
            return Response({"detail": f"Unable to read uploaded file: {e}"}, status=400)

        if not raw_bytes:
            return Response({"detail": "Uploaded file is empty."}, status=400)

        image_digest = sha256_bytes(raw_bytes)
        cached_payload = load_detection_cache(model_name, conf, image_digest)
        if cached_payload is not None:
            print("DEBUG: Cache hit", flush=True)
            resp = Response(cached_payload, status=200)
            resp["X-Detection-Cache"] = "HIT"
            return resp

        try:
            print("DEBUG: Opening image...", flush=True)
            image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
            print("DEBUG: Image opened", flush=True)
        except Exception as e:
            return Response({"detail": f"Invalid image: {e}"}, status=400)

        try:
            print(f"DEBUG: Running inference with model {model_name}...", flush=True)
            payload = run_inference(model_name, image, conf=conf)
            print("DEBUG: Inference done", flush=True)
        except FileNotFoundError as e:
            return Response({"detail": str(e)}, status=404)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        except Exception as e:
            return Response({"detail": f"Inference error: {e}"}, status=500)

        resp = Response(payload, status=200)
        resp["X-Detection-Cache"] = "MISS"
        try:
            store_detection_cache(model_name, conf, image_digest, payload)
        except Exception:
            pass
        return resp

class FhbFieldPipelineView(APIView):
    """
    Run the multi-stage FHB field assessment pipeline:
      1) Spike OBB detection + cropping
      2) Orientation classification to keep good spikes
      3) FHB detection + per-image aggregation (Excel + JSON summary)
    """
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Run FHB field assessment pipeline",
        description=(
            "Uploads one or more field images and executes the bundled pipeline "
            "(spike detection → orientation classifier → FHB scoring). "
            "Returns aggregated counts per source image and a downloadable Excel summary."
        ),
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {
                    "images": {"type": "array", "items": {"type": "string", "format": "binary"}, "description": "One or more images to process"},
                    "image": {"type": "string", "format": "binary", "description": "Alternate single-image key"},
                    "run_name": {"type": "string", "description": "Optional custom run label"},
                },
            }
        },
        responses={
            200: OpenApiResponse(
                response={
                    "type": "object",
                    "properties": {
                        "run_name": {"type": "string", "example": "fhb_field_ab12cd34"},
                        "inputs": {"type": "array", "items": {"type": "string"}},
                        "summary": {"type": "array", "items": {"type": "object"}},
                        "excel_name": {"type": "string", "example": "fhb_field_ab12cd34_fhb_field.xlsx"},
                        "excel_rel_path": {"type": "string"},
                        "results_root": {"type": "string"},
                        "logs": {"type": "array", "items": {"type": "object"}},
                        "overlays": {"type": "array", "items": {"type": "object"}},
                    }
                },
                description="Pipeline completed successfully."
            ),
            400: OpenApiResponse(description="Bad request (missing files)"),
            404: OpenApiResponse(description="Pipeline assets not found"),
            500: OpenApiResponse(description="Pipeline error"),
        },
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        files = request.FILES.getlist("images")
        if not files:
            single = request.FILES.get("image") or request.FILES.get("file")
            if single:
                files = [single]
        if not files:
            return Response({"detail": "No images uploaded. Use 'images' (list) or 'image' (single)."}, status=400)

        run_name = (request.data.get("run_name") or "").strip() or None
        try:
            payload = run_fhb_field_pipeline(files=files, run_name=run_name)
        except FileNotFoundError as e:
            return Response({"detail": str(e)}, status=404)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        except RuntimeError as e:
            return Response({"detail": str(e)}, status=400)
        except ImportError as e:
            return Response({"detail": str(e)}, status=500)
        except Exception as e:
            return Response({"detail": f"Pipeline error: {e}"}, status=500)

        return Response(payload, status=200)

class HealthView(APIView):
    permission_classes = [AllowAny]

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
    permission_classes = [AllowAny]
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
        owner = request.user if not request.user.is_anonymous else None

        job = DetectionJob.objects.create(
            image=image,
            confidence=confidence,
            status="QUEUED",
            progress=0,
            original_filename=image.name or "",
            owner=owner,
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
                    "model": {"type": "string", "enum": ["spike", "spikelet", "kernel_count_on_spike", "fhb", "fdk", "kernel", "uav_spike"], "default": "spike"},
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
        if request.user.is_anonymous:
            raise PermissionDenied("Login required for bulk processing.")
        serializer = BulkDetectRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        images = request.FILES.getlist('images')
        confidence = serializer.validated_data.get('confidence', 0.25)
        model_name = serializer.validated_data.get('model', 'spike')
        owner = request.user if not request.user.is_anonymous else None

        if not images:
            return Response({"detail": "No images provided."}, status=status.HTTP_400_BAD_REQUEST)

        bulk_job = BulkDetectionJob.objects.create(
            status="PENDING",
            owner=owner,
        )
        
        tasks = []
        sidemm = float(serializer.validated_data.get('sidemm', 40.0))
        allowed_ids_csv = serializer.validated_data.get('allowed_ids', "425,100,201,310")
        use_sam = bool(serializer.validated_data.get('use_sam', False))
        sam_checkpoint = serializer.validated_data.get('sam_checkpoint', "")
        sam_model_type = serializer.validated_data.get('sam_model_type', "vit_b")
        um_per_px = float(serializer.validated_data.get('um_per_px', 0.3448275862))
        stomata_iou = float(serializer.validated_data.get('iou', 0.7))
        stomata_sam_checkpoint = serializer.validated_data.get('sam_checkpoint', "")
        stomata_sam_model_type = serializer.validated_data.get('sam_model_type', "vit_b")
        bulk_queue = os.getenv("CELERY_BULK_QUEUE", "celery")

        with transaction.atomic():
            for image_file in images:
                job = DetectionJob.objects.create(
                    image=image_file,
                    confidence=confidence,
                    status="QUEUED",
                    progress=0,
                    original_filename=image_file.name or "",
                    owner=owner,
                )
                bulk_job.jobs.add(job)
                if model_name.lower() == "kernel":
                    tasks.append(
                        run_kernel_measurement.s(
                            str(job.id),
                            job.image.path,
                            model_name,
                            sidemm,
                            allowed_ids_csv,
                            use_sam,
                            sam_checkpoint,
                            sam_model_type,
                        ).set(queue=bulk_queue)
                    )
                elif model_name.lower() == "stomata":
                    tasks.append(
                        run_stomata_measurement.s(
                            str(job.id),
                            job.image.path,
                            um_per_px,
                            confidence,
                            stomata_iou,
                            stomata_sam_checkpoint,
                            stomata_sam_model_type,
                        ).set(queue=bulk_queue)
                    )
                else:
                    tasks.append(
                        run_large_detection.s(str(job.id), job.image.path, confidence, model_name).set(queue=bulk_queue)
                    )

        # Mark bulk job as processing while individual jobs run
        bulk_job.status = "PROCESSING"
        bulk_job.save(update_fields=["status"])

        # Use immutable signature so Celery does not prepend header results
        callback = generate_excel_report.si(str(bulk_job.id)).set(queue=bulk_queue)
        chord(group(tasks), callback).apply_async()

        return Response(
            {"bulk_job_id": str(bulk_job.id), "message": "Bulk job submitted successfully"},
            status=status.HTTP_202_ACCEPTED
        )

class BulkJobsView(generics.ListAPIView):
    """List all bulk detection jobs."""
    serializer_class = BulkDetectionJobSerializer
    def get_queryset(self):
        return _accessible_bulk_jobs(self.request.user).order_by("-created_at")

class JobDetailView(generics.RetrieveAPIView):
    serializer_class = DetectionJobSerializer
    lookup_field = "id"
    permission_classes = [AllowAny]
    def get_queryset(self):
        return _accessible_detection_jobs(self.request.user, include_public=True)

class ListJobsView(generics.ListAPIView):
    """List all individual detection jobs with filtering and pagination support."""
    serializer_class = DetectionJobSerializer
    def get_queryset(self):
        return _accessible_detection_jobs(self.request.user).order_by("-created_at")

class DownloadAnnotatedImageView(APIView):
    # ... (content of DownloadAnnotatedImageView is unchanged)
    permission_classes = [AllowAny]

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
        _authenticate_from_query(request)
        # accept uppercase/lowercase extensions
        import os
        ext = os.path.splitext(fname)[1].lower()
        if ext not in (".jpg", ".jpeg"):
            raise Http404()
        
        rel = f"annotated/{fname}"
        _ensure_job_access_by_rel(request.user, rel, "annotated_image")
        path = (
            default_storage.path(rel)
            if hasattr(default_storage, "path")
            else os.path.join(settings.MEDIA_ROOT, rel)
        )
        if not os.path.exists(path):
            raise Http404()
        
        return FileResponse(open(path, "rb"), as_attachment=True, filename=fname, content_type="image/jpeg")

def _labels_enabled() -> bool:
    return os.getenv("DOWNLOAD_LABELS", "1").strip().lower() not in ("0", "false", "no")


class DownloadLabelsView(APIView):
        # ... (content of DownloadLabelsView is unchanged)
    permission_classes = [AllowAny]

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
        _authenticate_from_query(request)
        if not _labels_enabled():
            raise Http404("TXT label downloads are disabled.")
        # accept uppercase/lowercase extensions
        if not fname.lower().endswith(".txt"):
            raise Http404()
        rel = f"labels/{fname}"
        _ensure_job_access_by_rel(request.user, rel, "labels_file")
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
    permission_classes = [AllowAny]

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
        _authenticate_from_query(request)
        if not fname.lower().endswith(".xlsx"):
            raise Http404("Invalid file extension.")
        
        rel_path = f"reports/{fname}"
        _ensure_bulk_access_by_rel(request.user, rel_path, "excel_file")
        abs_path = os.path.join(settings.MEDIA_ROOT, rel_path)
        
        if not os.path.exists(abs_path):
            raise Http404("File not found.")
        
        return FileResponse(
            open(abs_path, "rb"),
            as_attachment=True,
            filename=fname,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

class DownloadMediaView(APIView):
    """
    Generic media downloader for files produced by pipelines (FHB field, etc.).
    """
    permission_classes = [AllowAny]

    def get(self, request, rel: str):
        _authenticate_from_query(request)
        rel_norm = os.path.normpath(rel).lstrip(os.sep)
        base = os.path.abspath(settings.MEDIA_ROOT)
        abs_path = os.path.abspath(os.path.join(base, rel_norm))
        if not abs_path.startswith(base):
            raise Http404("Invalid path")
        _ensure_media_access(request.user, rel_norm)
        if not os.path.exists(abs_path):
            raise Http404("File not found")
        mime, _ = mimetypes.guess_type(abs_path)
        return FileResponse(open(abs_path, "rb"), as_attachment=True, filename=os.path.basename(abs_path), content_type=mime or "application/octet-stream")

class DownloadMeasureImageView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Download kernel measurement overlay image",
        parameters=[OpenApiParameter(name='fname', type=OpenApiTypes.STR, location=OpenApiParameter.PATH)],
        responses={200: OpenApiResponse(response={'type': 'string', 'format': 'binary'})},
        tags=["Detection"],
    )
    def get(self, request, fname: str):
        _authenticate_from_query(request)
        rel = os.path.join("measure", fname)
        _ensure_measure_access(request.user, rel)
        abs_path = os.path.join(settings.MEDIA_ROOT, rel)
        if not os.path.exists(abs_path):
            raise Http404()
        return FileResponse(open(abs_path, "rb"), as_attachment=True, filename=fname, content_type="image/png")

class DownloadMeasureCSVView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Download kernel measurement CSV",
        parameters=[OpenApiParameter(name='fname', type=OpenApiTypes.STR, location=OpenApiParameter.PATH)],
        responses={200: OpenApiResponse(response={'type': 'string', 'format': 'binary'})},
        tags=["Detection"],
    )
    def get(self, request, fname: str):
        _authenticate_from_query(request)
        rel = os.path.join("measure", fname)
        _ensure_measure_access(request.user, rel)
        abs_path = os.path.join(settings.MEDIA_ROOT, rel)
        if not os.path.exists(abs_path):
            raise Http404()
        return FileResponse(open(abs_path, "rb"), as_attachment=True, filename=fname, content_type="text/csv")


class KernelMeasureView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Submit kernel size measurement job",
        description=
        """
        Runs YOLO-OBB detection followed by ArUco-based metric conversion to compute kernel length/width (and optional SAM refinement).
        Returns a job ID; poll jobs list or fetch the job to retrieve CSV and overlay paths when done.
        """,
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'image': {'type': 'string', 'format': 'binary', 'description': 'Image to process'},
                    'model': {'type': 'string', 'default': 'kernel', 'description': 'Model key to use (detect_models.MODEL_REGISTRY)'},
                    'sidemm': {'type': 'number', 'description': 'ArUco marker side length in millimeters'},
                    'allowed_ids': {'type': 'string', 'default': '0,1,2,3', 'description': 'Comma-separated allowed ArUco IDs'},
                    'use_sam': {'type': 'boolean', 'default': False},
                    'sam_checkpoint': {'type': 'string', 'default': ''},
                    'sam_model_type': {'type': 'string', 'enum': ['vit_b','vit_l','vit_h'], 'default': 'vit_b'},
                },
                'required': ['image', 'sidemm']
            }
        },
        responses={
            202: OpenApiResponse(
                response={
                    'type': 'object',
                    'properties': {
                        'unique_id': {'type': 'string', 'format': 'uuid'},
                        'success': {'type': 'boolean'},
                        'message': {'type': 'string', 'example': 'Job submitted successfully'}
                    }
                },
                description='Measurement job submitted'
            ),
        },
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        s = KernelMeasureRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        if "image" not in request.FILES:
            return Response({"detail": "image file is required"}, status=400)

        upload = request.FILES["image"]
        try:
            raw_bytes = upload.read()
        except Exception as e:
            return Response({"detail": f"Unable to read uploaded file: {e}"}, status=400)

        if not raw_bytes:
            return Response({"detail": "Uploaded file is empty."}, status=400)

        owner = request.user if not request.user.is_anonymous else None

        image_digest = hashlib.sha256(raw_bytes).hexdigest()
        model_name = s.validated_data.get("model", "kernel")
        sidemm = float(s.validated_data["sidemm"])
        allowed_ids_raw = s.validated_data.get("allowed_ids", "0,1,2,3")
        allowed_ids_csv = normalize_allowed_ids_csv(allowed_ids_raw)
        use_sam = bool(s.validated_data.get("use_sam", False))
        sam_checkpoint = s.validated_data.get("sam_checkpoint", "")
        sam_model_type = s.validated_data.get("sam_model_type", "vit_b")

        params_hash, _ = compute_kernel_params_hash(
            model_name,
            sidemm,
            allowed_ids_csv,
            use_sam,
            sam_checkpoint,
            sam_model_type,
        )

        cached_payload = None
        if image_digest and params_hash:
            cached_payload = load_kernel_cache(image_digest, params_hash)

        original_name = upload.name or "kernel-image"
        ext = os.path.splitext(original_name)[1] or ".jpg"
        stored_name = f"{image_digest}{ext}"

        if cached_payload is not None:
            payload = dict(cached_payload)
            job = DetectionJob.objects.create(
                image=ContentFile(raw_bytes, name=stored_name),
                status="DONE",
                progress=100,
                result=json.dumps(payload),
                original_filename=original_name,
                owner=owner,
            )
            return Response({"unique_id": str(job.id), "success": True, "cached": True}, status=status.HTTP_200_OK)

        params_hash, _descriptor = compute_stomata_params_hash(
            s.validated_data.get("um_per_px", 0.3448275862),
            s.validated_data.get("conf", 0.25),
            s.validated_data.get("iou", 0.7),
            s.validated_data.get("sam_checkpoint", ""),
            s.validated_data.get("sam_model_type", "vit_b"),
        )
        cached_payload = None
        if image_digest and params_hash:
            cached_payload = load_stomata_cache(image_digest, params_hash)

        if cached_payload is not None:
            job = DetectionJob.objects.create(
                image=ContentFile(raw_bytes, name=stored_name),
                status="DONE",
                progress=100,
                result=json.dumps(cached_payload),
                original_filename=original_name,
                owner=owner,
            )
            return Response({"unique_id": str(job.id), "success": True, "cached": True}, status=status.HTTP_200_OK)

        job = DetectionJob.objects.create(
            image=ContentFile(raw_bytes, name=stored_name),
            status="QUEUED",
            progress=0,
            original_filename=original_name,
            owner=owner,
        )

        image_path = job.image.path
        run_kernel_measurement.delay(
            str(job.id),
            image_path,
            model_name,
            sidemm,
            allowed_ids_csv,
            use_sam,
            sam_checkpoint,
            sam_model_type,
            image_digest,
            params_hash,
        )

        return Response({"unique_id": str(job.id), "success": True, "cached": False}, status=status.HTTP_202_ACCEPTED)


class StomataMeasureView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        summary="Submit stomata measurement job",
        description=
        """
        Runs the stomata pipeline (YOLO-OBB + SAM) and returns a job ID.
        Poll jobs list or fetch the job to retrieve overlay + Excel + table data when done.
        """,
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'image': {'type': 'string', 'format': 'binary', 'description': 'Image to process'},
                    'um_per_px': {'type': 'number', 'default': 0.3448275862, 'description': 'Micrometers per pixel'},
                    'conf': {'type': 'number', 'default': 0.25},
                    'iou': {'type': 'number', 'default': 0.7},
                    'sam_checkpoint': {'type': 'string', 'default': ''},
                    'sam_model_type': {'type': 'string', 'enum': ['vit_b','vit_l','vit_h'], 'default': 'vit_b'},
                },
                'required': ['image']
            }
        },
        responses={
            202: OpenApiResponse(
                response={
                    'type': 'object',
                    'properties': {
                        'unique_id': {'type': 'string', 'format': 'uuid'},
                        'success': {'type': 'boolean'},
                        'message': {'type': 'string', 'example': 'Job submitted successfully'}
                    }
                },
                description='Measurement job submitted'
            ),
        },
        tags=["Detection"],
    )
    def post(self, request, *args, **kwargs):
        s = StomataMeasureRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        if "image" not in request.FILES:
            return Response({"detail": "image file is required"}, status=400)

        upload = request.FILES["image"]
        try:
            raw_bytes = upload.read()
        except Exception as e:
            return Response({"detail": f"Unable to read uploaded file: {e}"}, status=400)

        if not raw_bytes:
            return Response({"detail": "Uploaded file is empty."}, status=400)

        owner = request.user if not request.user.is_anonymous else None

        image_digest = hashlib.sha256(raw_bytes).hexdigest()
        original_name = upload.name or "stomata-image"
        ext = os.path.splitext(original_name)[1] or ".jpg"
        stored_name = f"{image_digest}{ext}"

        job = DetectionJob.objects.create(
            image=ContentFile(raw_bytes, name=stored_name),
            status="QUEUED",
            progress=0,
            original_filename=original_name,
            owner=owner,
        )

        um_per_px = float(s.validated_data.get("um_per_px", 0.3448275862))
        conf = float(s.validated_data.get("conf", 0.25))
        iou = float(s.validated_data.get("iou", 0.7))
        sam_checkpoint = s.validated_data.get("sam_checkpoint", "")
        sam_model_type = s.validated_data.get("sam_model_type", "vit_b")
        params_hash, _descriptor = compute_stomata_params_hash(
            um_per_px,
            conf,
            iou,
            sam_checkpoint,
            sam_model_type,
        )

        run_stomata_measurement.delay(
            str(job.id),
            job.image.path,
            um_per_px,
            conf,
            iou,
            sam_checkpoint,
            sam_model_type,
            image_digest,
            params_hash,
        )

        return Response({"unique_id": str(job.id), "success": True}, status=status.HTTP_202_ACCEPTED)
