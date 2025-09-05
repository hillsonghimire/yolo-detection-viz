# detections/tasks.py
from __future__ import annotations

import os
import json
from celery import shared_task
from django.db import transaction
from django.conf import settings
from typing import List, Dict, Any, Tuple

from .models import DetectionJob
from .inference import run_detection


# New helper function to get an axis-aligned bounding box from a polygon
def _aabb_from_polygon(pts: List[float]) -> Tuple[int, int, int, int]:
    """Given a list of polygon points, return the axis-aligned bounding box."""
    xs = pts[0::2]
    ys = pts[1::2]
    return int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))


def _write_labels_txt(job_id: str, detections: list[dict]) -> str:
    """
    Write a simple YOLO-ish txt of [class_id, x1, y1, x2, y2, confidence] per line.
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
            
            # Check if poly exists and has enough points
            if poly and len(poly) >= 8:
                x1, y1, x2, y2 = _aabb_from_polygon(poly)
                f.write(f"{cid} {x1} {y1} {x2} {y2} {conf}\n")

    return rel_path


@shared_task(bind=True)
def run_large_detection(self, job_id: str, image_path: str, confidence: float, model_name: str) -> None:
    """
    Celery task: run OBB detection and update the job record.
    """
    try:
        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.status = "PROCESSING"
            job.progress = 10
            job.save(update_fields=["status", "progress"])

        detections, meta = run_detection(image_path, confidence=confidence, model_name=model_name)

        # Build API-friendly result payload similar to your sample
        result_payload = {
            "success": True,
            "unique_id": str(job_id),
            "detection_count": len(detections),
            "detections": detections,
            "image_width": meta.get("image_width"),
            "image_height": meta.get("image_height"),
        }

        # Optional: write labels .txt for download
        labels_rel = _write_labels_txt(str(job_id), detections)

        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.result = json.dumps(result_payload)
            job.labels_file = labels_rel
            job.status = "DONE"
            job.progress = 100
            job.save(update_fields=["result", "labels_file", "status", "progress"])

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