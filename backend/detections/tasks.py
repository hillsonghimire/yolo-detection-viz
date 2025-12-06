# detections/tasks.py
from __future__ import annotations

import os
import json
import hashlib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from celery import shared_task
from django.db import transaction
from django.db.models import F
from django.conf import settings
from typing import List, Dict, Any, Tuple
from PIL import Image, ImageOps

from .models import DetectionJob
from .inference import run_detection, _image_dims
from django.utils import timezone
from . import kernel_size_measure as ksm
from .kernel_cache import (
    normalize_allowed_ids_csv,
    compute_kernel_params_hash,
    load_kernel_cache,
    store_kernel_cache,
)


# New helper function to get an axis-aligned bounding box from a polygon
def _aabb_from_polygon(pts: List[float]) -> Tuple[int, int, int, int]:
    """Given a list of polygon points, return the axis-aligned bounding box."""
    xs = pts[0::2]
    ys = pts[1::2]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))


def _write_labels_txt(job_id: str, detections: list[dict]) -> str:
    """
    Writes a labels.txt file with annotations including confidence.
    Format: class_id x1 y1 x2 y2 x3 y3 x4 y4 confidence.
    Returns a relative path under MEDIA_ROOT.
    """
    fname = f"{job_id}.txt"
    rel_path = os.path.join("labels", fname)
    abs_dir = os.path.join(settings.MEDIA_ROOT, "labels")
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(abs_dir, fname)

    with open(abs_path, "w", encoding="utf-8") as f:
        for d in detections:
            cid = d.get("class_id", 0)
            conf = d.get("confidence")
            poly = d.get("polygon")
            
            # Check if poly exists and has exactly 8 points
            if poly and len(poly) == 8:
                poly_str = " ".join([str(p) for p in poly])
                f.write(f"{cid} {poly_str} {conf}\n")
            else:
                print(f"Skipping detection with malformed polygon data: {d}")

    return rel_path


def _write_mm_norm_labels_txt(image_path: str, detections: list[dict], meta: dict, out_dir: str) -> str:
    """
    Write labels in the format expected by kernel_size_measure.yolo_obb_read:
    class conf x1 y1 x2 y2 x3 y3 x4 y4 (normalized to [0,1]).
    Returns relative path under MEDIA_ROOT.
    """
    fname = f"{os.path.splitext(os.path.basename(image_path))[0]}.txt"
    rel_path = os.path.join("labels_mm", fname)
    abs_dir = os.path.join(settings.MEDIA_ROOT, "labels_mm")
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(abs_dir, fname)

    iw = float(meta.get("image_width") or 0) or _image_dims(image_path)[0]
    ih = float(meta.get("image_height") or 0) or _image_dims(image_path)[1]
    iw = float(iw) if iw else 1.0
    ih = float(ih) if ih else 1.0

    with open(abs_path, "w", encoding="utf-8") as f:
        for d in detections:
            cls = d.get("class_id")
            if cls is None:
                try:
                    cls = int(d.get("class"))
                except Exception:
                    cls = 0
            conf = d.get("confidence")
            poly = d.get("polygon") or d.get("poly")
            if not poly or len(poly) != 8:
                continue
            x1, y1, x2, y2, x3, y3, x4, y4 = [float(v) for v in poly]
            coords = [
                x1 / iw, y1 / ih,
                x2 / iw, y2 / ih,
                x3 / iw, y3 / ih,
                x4 / iw, y4 / ih,
            ]
            parts = [str(int(cls)), f"{float(conf) if conf is not None else 0.0:.4f}"] + [f"{c:.6f}" for c in coords]
            f.write(" ".join(parts) + "\n")
    return rel_path

def _generate_annotated_image_from_txt(job_id: str, image_path: str, labels_txt_path: str, model_name: str | None = None) -> str:
    """
    Generates an image with bounding boxes from a labels.txt file.
    The file is expected to contain 'class_id x1 y1 x2 y2 x3 y3 x4 y4 conf'.
    Applies EXIF transpose to match the orientation used for detection.
    Returns the relative path to the saved image.
    """
    try:
        image = Image.open(image_path)
        # Apply EXIF transpose to match the orientation used for detection
        try:
            image = ImageOps.exif_transpose(image).convert("RGB")
        except Exception as exif_error:
            # If EXIF transpose fails, just convert to RGB
            image = image.convert("RGB")
            print(f"EXIF transpose failed for {image_path}: {exif_error}, using original orientation")
    except Exception as load_error:
        print(f"Error loading image {image_path}: {load_error}")
        return ""

    # Create figure with exact image dimensions to avoid padding/aspect ratio issues
    fig, ax = plt.subplots(1, figsize=(image.width / 100, image.height / 100), dpi=100)
    ax.imshow(image)
    # Remove title to avoid padding
    # ax.set_title(f"Detections for {os.path.basename(image_path)}")

    model_key = (model_name or "").lower()
    class_color_map = {
        0: 'red',
        1: 'blue',
        2: 'green',
        3: 'purple',
        4: 'yellow',
    }
    class_label_map = {}
    if model_key == "fhb":
        # Flip colors so infected (class_1) is red and healthy (class_0) is blue
        class_color_map = {
            0: 'blue',
            1: 'red',
            2: 'green',
            3: 'purple',
            4: 'yellow',
        }
        class_label_map = {
            0: "healthy_spikelet",
            1: "infected_spikelet",
        }
    elif model_key == "fdk":
        # Keep infected (class_0) red and healthy (class_1) blue to match single-image view
        class_label_map = {
            0: "infected_kernel",
            1: "healthy_kernel",
        }

    try:
        with open(labels_txt_path, 'r') as f:
            lines = f.readlines()
    except FileNotFoundError:
        print(f"Labels file not found: {labels_txt_path}")
        plt.close(fig)
        return ""

    for line in lines:
        parts = line.strip().split()
        if len(parts) != 10:
            print(f"Skipping malformed annotation: {line}")
            continue

        class_id = int(parts[0])
        points = np.array([
            (float(parts[1]), float(parts[2])),
            (float(parts[3]), float(parts[4])),
            (float(parts[5]), float(parts[6])),
            (float(parts[7]), float(parts[8]))
        ])

        color = class_color_map.get(class_id, 'black')
        polygon = patches.Polygon(points, closed=True, edgecolor=color, fill=False, linewidth=1)
        ax.add_patch(polygon)

        conf_value = float(parts[9])
        cls_label = class_label_map.get(class_id, f"Class {class_id}")
        label = f"{cls_label}: {conf_value:.2f}"
        cx, cy = np.mean(points, axis=0)
        ax.text(cx, cy, label, color='white', fontsize=8, ha='center', va='center', bbox=dict(facecolor=color, alpha=0.5, edgecolor='none', boxstyle='round,pad=0.2'))

    ax.axis('off')
    # Remove all padding and margins
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    ax.margins(0)

    fname = f"{job_id}.jpg"
    rel_path = os.path.join("annotated", fname)
    abs_dir = os.path.join(settings.MEDIA_ROOT, "annotated")
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(abs_dir, fname)

    # Save with no padding and exact dimensions
    plt.savefig(abs_path, bbox_inches='tight', pad_inches=0, dpi=100, facecolor='black')
    plt.close(fig)
    print(f"Saved annotated image: {abs_path}")
    
    return rel_path

@shared_task(bind=True)
def run_large_detection(self, job_id: str, image_path: str, confidence: float, model_name: str) -> str:
    """
    Celery task: run OBB detection and update the job record.
    Returns the job_id on success for the chord to continue.
    """
    try:
        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.status = "PROCESSING"
            job.progress = 10
            job.save(update_fields=["status", "progress"])

        detections, meta = run_detection(image_path, confidence=confidence, model_name=model_name)

        # Optional: write labels .txt for download
        labels_rel_path = _write_labels_txt(str(job_id), detections)
        annotated_image_rel_path = _generate_annotated_image_from_txt(str(job_id), image_path, os.path.join(settings.MEDIA_ROOT, labels_rel_path), model_name)

        # Build API-friendly result payload similar to your sample
        result_payload = {
            "success": True,
            "unique_id": str(job_id),
            "detection_count": len(detections),
            "detections": detections,
            "image_width": meta.get("image_width"),
            "image_height": meta.get("image_height"),
            "model": model_name,
        }

        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.result = json.dumps(result_payload)
            job.labels_file = labels_rel_path
            job.annotated_image = annotated_image_rel_path
            job.status = "DONE"
            job.progress = 100
            job.save(update_fields=["result", "labels_file", "annotated_image", "status", "progress"])

        return job_id

    except Exception as e:
        with transaction.atomic():
            try:
                job = DetectionJob.objects.select_for_update().get(id=job_id)
                job.status = "FAILED"
                job.progress = 100
                job.result = json.dumps({"success": False, "error": str(e)})
                job.save(update_fields=["status", "progress", "result"])
            except Exception:
                pass
        raise


@shared_task(bind=True)
def run_kernel_measurement(self,
                           job_id: str,
                           image_path: str,
                           model_name: str,
                           sidemm: float,
                           allowed_ids_csv: str,
                           use_sam: bool = False,
                           sam_checkpoint: str = "",
                           sam_model_type: str = "vit_b",
                           image_digest: str = "",
                           params_hash: str = "") -> str:
    """
    Celery task to run kernel size measurement using YOLO-OBB detections and ArUco markers.
    - Runs detection with the specified model
    - Writes a normalized OBB label file for measurement
    - Executes ArUco+measurement pipeline (with optional SAM refinement)
    Persists CSV + overlay under MEDIA_ROOT and stores paths in the job result JSON.
    Returns the job_id on success.
    """
    try:
        allowed_ids_csv_norm = normalize_allowed_ids_csv(allowed_ids_csv)
        params_hash_local, descriptor = compute_kernel_params_hash(
            model_name,
            sidemm,
            allowed_ids_csv_norm,
            use_sam,
            sam_checkpoint,
            sam_model_type,
        )

        params_hash_final = params_hash or params_hash_local
        if params_hash_final != params_hash_local:
            params_hash_final = params_hash_local

        image_digest_final = image_digest
        if not image_digest_final:
            try:
                with open(image_path, "rb") as fh:
                    image_digest_final = hashlib.sha256(fh.read()).hexdigest()
            except Exception:
                image_digest_final = ""

        if image_digest_final and params_hash_final:
            cached_payload = load_kernel_cache(image_digest_final, params_hash_final)
            if cached_payload is not None:
                with transaction.atomic():
                    job = DetectionJob.objects.select_for_update().get(id=job_id)
                    job.result = json.dumps(cached_payload)
                    job.status = "DONE"
                    job.progress = 100
                    job.save(update_fields=["result", "status", "progress"])
                return job_id

        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.status = "PROCESSING"
            job.progress = 10
            job.save(update_fields=["status", "progress"])

        dets, meta = run_detection(image_path, confidence=0.05, model_name=model_name)

        # Prepare label file in expected format
        labels_rel_path = _write_mm_norm_labels_txt(image_path, dets, meta, settings.MEDIA_ROOT)
        labels_abs_path = os.path.join(settings.MEDIA_ROOT, labels_rel_path)

        # Generate annotated image for download
        annotated_image_rel_path = _generate_annotated_image_from_txt(str(job_id), image_path, labels_abs_path, model_name)

        # Run measurement
        allowed_ids = set()
        try:
            allowed_ids = set(int(x.strip()) for x in (allowed_ids_csv_norm or "").split(",") if x.strip())
        except Exception:
            allowed_ids = {425, 100, 201, 310}
        if not allowed_ids:
            allowed_ids = {425, 100, 201, 310}

        out_dir_abs = os.path.join(settings.MEDIA_ROOT, "measure")
        os.makedirs(out_dir_abs, exist_ok=True)

        if use_sam and sam_checkpoint:
            csv_abs, overlay_abs = ksm.run_aruco_sam(
                image_path=image_path,
                pred_path=labels_abs_path,
                sam_checkpoint_path=sam_checkpoint,
                sam_model_type=sam_model_type,
                sidemm=float(sidemm),
                allowed_ids=allowed_ids,
                output_dir=out_dir_abs,
            )
        else:
            csv_abs, overlay_abs = ksm.run_aruco_nosam(
                image_path=image_path,
                pred_path=labels_abs_path,
                sidemm=float(sidemm),
                allowed_ids=allowed_ids,
                output_dir=out_dir_abs,
            )

        csv_rel = os.path.relpath(csv_abs, settings.MEDIA_ROOT)
        overlay_rel = os.path.relpath(overlay_abs, settings.MEDIA_ROOT)

        result_payload = {
            "success": True,
            "unique_id": str(job_id),
            "measurement_csv": csv_rel,
            "measurement_overlay": overlay_rel,
            "model": model_name,
            "sidemm": sidemm,
            "allowed_ids": sorted(list(allowed_ids)),
            "timestamp": timezone.now().isoformat(),
        }

        if image_digest_final and params_hash_final:
            cached_out = store_kernel_cache(
                image_digest_final,
                params_hash_final,
                descriptor,
                result_payload,
                csv_abs,
                overlay_abs,
            )
            if cached_out is not None:
                result_payload = cached_out

        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.result = json.dumps(result_payload)
            job.annotated_image = annotated_image_rel_path
            job.status = "DONE"
            job.progress = 100
            job.save(update_fields=["result", "annotated_image", "status", "progress"])

        return job_id

    except Exception as e:
        with transaction.atomic():
            try:
                job = DetectionJob.objects.select_for_update().get(id=job_id)
                job.status = "FAILED"
                job.progress = 100
                job.result = json.dumps({
                    "success": False,
                    "error": str(e),
                    "trace": getattr(e, "__class__", type(e)).__name__,
                })
                job.save(update_fields=["status", "progress", "result"])
            except Exception:
                pass
        raise

def _count_from_labels_txt(abs_labels_path: str) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    try:
        with open(abs_labels_path, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split()
                if not parts:
                    continue
                # Expect: class_id x1 y1 x2 y2 x3 y3 x4 y4 conf  => len 10
                try:
                    class_id = int(float(parts[0]))
                except ValueError:
                    continue
                col = f"Class_{class_id}"
                counts[col] = counts.get(col, 0) + 1
    except FileNotFoundError:
        return {}
    return counts


@shared_task
def generate_excel_report(*args, **kwargs) -> None:
    """
    Chord callback to build Excel report.
    Accepts any calling convention:
    - immutable signature: (bulk_job_id,)
    - standard chord: (header_results, bulk_job_id)
    - kwargs: bulk_job_id=<uuid>
    """
    # Extract bulk_job_id robustly
    bulk_job_id: str | None = kwargs.get("bulk_job_id")
    header_results: Any | None = None

    if bulk_job_id is None:
        if len(args) == 1:
            # Likely immutable signature: only bulk_job_id
            bulk_job_id = args[0]
        elif len(args) >= 2:
            # Standard chord: results, bulk_job_id
            header_results = args[0]
            bulk_job_id = args[1]

    if isinstance(bulk_job_id, (list, tuple)) and header_results is None:
        # Mis-ordered: first arg is results list, second missing; try to fix
        header_results = bulk_job_id
        bulk_job_id = args[1] if len(args) > 1 else None

    if not bulk_job_id:
        print("Error: bulk_job_id missing in generate_excel_report")
        raise ValueError("bulk_job_id missing for report generation")

    try:
        from .models import BulkDetectionJob

        bulk_job = BulkDetectionJob.objects.get(id=bulk_job_id)
        jobs = bulk_job.jobs.all()

        rows: List[Dict[str, Any]] = []
        all_class_cols: set[str] = set()
        bulk_model: str | None = None

        for job in jobs:
            file_name = os.path.basename(job.image.name) if job.image else str(job.id)

            # Prefer fast parsing of pre-generated labels file
            detection_counts: Dict[str, int] = {}
            if job.labels_file:
                abs_labels_path = os.path.join(settings.MEDIA_ROOT, job.labels_file)
                detection_counts = _count_from_labels_txt(abs_labels_path)

            result_data: Dict[str, Any] = {}
            # Fallback to result JSON if labels file missing or empty
            if not detection_counts and job.result:
                try:
                    result_data = json.loads(job.result) if isinstance(job.result, str) else job.result
                except (TypeError, json.JSONDecodeError):
                    result_data = job.result if isinstance(job.result, dict) else {}
                for det in result_data.get("detections", []) or []:
                    cid = det.get("class_id")
                    if cid is None:
                        # fallback to 'class' if present
                        try:
                            cid = int(det.get("class"))
                        except Exception:
                            continue
                    col = f"Class_{cid}"
                    detection_counts[col] = detection_counts.get(col, 0) + 1

            # Capture model name (used for FHB-specific renaming)
            try:
                if not result_data and job.result:
                    result_data = json.loads(job.result) if isinstance(job.result, str) else job.result or {}
            except Exception:
                result_data = result_data or {}
            model_name = None
            if isinstance(result_data, dict):
                model_name = str(result_data.get("model") or "").lower() or None
            if model_name and bulk_model is None:
                bulk_model = model_name

            # Accumulate
            all_class_cols.update(detection_counts.keys())
            rows.append({"file_name": file_name, **detection_counts})

        # Build DataFrame with consistent columns
        columns = ["file_name"] + sorted(all_class_cols)
        df = pd.DataFrame(rows, columns=columns).fillna(0)

        model_lower = (bulk_model or "").lower()

        if model_lower == "fhb":
            rename_map = {
                "Class_0": "healthy_spikelet",
                "Class_1": "infected_spikelet",
            }
            df = df.rename(columns=rename_map)
            for col in ["healthy_spikelet", "infected_spikelet"]:
                if col not in df.columns:
                    df[col] = 0
            total = df["healthy_spikelet"].astype(float) + df["infected_spikelet"].astype(float)
            dsr = np.where(total > 0, (df["infected_spikelet"].astype(float) / total) * 100.0, 0.0)
            df["Disease Spikelet Rate (DSR)"] = np.round(dsr, 1)
            ordered_cols = ["file_name", "healthy_spikelet", "infected_spikelet", "Disease Spikelet Rate (DSR)"]
            remaining_cols = [c for c in df.columns if c not in ordered_cols]
            df = df[ordered_cols + remaining_cols]
        elif model_lower == "fdk":
            # Align bulk Excel labels with single-image view: class 0 = infected, class 1 = healthy
            rename_map = {
                "Class_0": "infected_kernels",
                "Class_1": "healthy_kernels",
            }
            df = df.rename(columns=rename_map)
            for col in ["infected_kernels", "healthy_kernels"]:
                if col not in df.columns:
                    df[col] = 0
            total = df["infected_kernels"].astype(float) + df["healthy_kernels"].astype(float)
            fdk_rate = np.where(total > 0, (df["infected_kernels"].astype(float) / total) * 100.0, 0.0)
            df["Percent FDK"] = np.round(fdk_rate, 1)
            ordered_cols = ["file_name", "infected_kernels", "healthy_kernels", "Percent FDK"]
            remaining_cols = [c for c in df.columns if c not in ordered_cols]
            df = df[ordered_cols + remaining_cols]

        # Avoid printing massive frames
        if not df.empty and len(df) <= 100:
            print("--- Excel Report Data Preview (Top 5 Entries) ---")
            print(df.head())
            print("--------------------------------------------------")
        else:
            print(f"Skipping DataFrame print: DataFrame has {len(df)} rows.")

        fname = f"{bulk_job_id}_report.xlsx"
        rel_path = os.path.join("reports", fname)
        abs_dir = os.path.join(settings.MEDIA_ROOT, "reports")
        os.makedirs(abs_dir, exist_ok=True)
        abs_path = os.path.join(abs_dir, fname)

        df.to_excel(abs_path, index=False)

        bulk_job.excel_file = rel_path
        bulk_job.status = "DONE"
        bulk_job.save(update_fields=["excel_file", "status"])
        print(f"Excel report saved: {abs_path}")

    except Exception as e:
        print(f"Error generating Excel report for bulk job {bulk_job_id}: {e}")
        try:
            bulk_job = BulkDetectionJob.objects.get(id=bulk_job_id)
            bulk_job.status = "FAILED"
            bulk_job.save(update_fields=["status"])
        except BulkDetectionJob.DoesNotExist:
            print(f"BulkDetectionJob with ID {bulk_job_id} does not exist.")
        raise
