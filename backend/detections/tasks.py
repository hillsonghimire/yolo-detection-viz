# detections/tasks.py
from __future__ import annotations

import os
import json
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from celery import shared_task
from django.db import transaction
from django.conf import settings
from typing import List, Dict, Any, Tuple
from PIL import Image

from .models import DetectionJob
from .inference import run_detection, _image_dims


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

def _generate_annotated_image_from_txt(job_id: str, image_path: str, labels_txt_path: str) -> str:
    """
    Generates an image with bounding boxes from a labels.txt file.
    The file is expected to contain 'class_id x1 y1 x2 y2 x3 y3 x4 y4 conf'.
    Returns the relative path to the saved image.
    """
    try:
        image = Image.open(image_path)
    except Exception:
        print(f"Error loading image: {image_path}")
        return ""

    fig, ax = plt.subplots(1, figsize=(image.width / 100, image.height / 100), dpi=100)
    ax.imshow(image)
    ax.set_title(f"Detections for {os.path.basename(image_path)}")
    
    class_color_map = {
        0: 'red',
        1: 'blue',
        2: 'green',
        3: 'purple',
        4: 'yellow',
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
        label = f"Class {class_id}: {conf_value:.2f}"
        cx, cy = np.mean(points, axis=0)
        ax.text(cx, cy, label, color='white', fontsize=8, ha='center', va='center', bbox=dict(facecolor=color, alpha=0.5, edgecolor='none', boxstyle='round,pad=0.2'))

    ax.axis('off')
    
    fname = f"{job_id}.jpg"
    rel_path = os.path.join("annotated", fname)
    abs_dir = os.path.join(settings.MEDIA_ROOT, "annotated")
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(abs_dir, fname)
    
    plt.savefig(abs_path, bbox_inches='tight', pad_inches=0, dpi=300)
    plt.close(fig)
    print(f"Saved annotated image: {abs_path}")
    
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

        # Optional: write labels .txt for download
        labels_rel_path = _write_labels_txt(str(job_id), detections)
        annotated_image_rel_path = _generate_annotated_image_from_txt(str(job_id), image_path, os.path.join(settings.MEDIA_ROOT, labels_rel_path))

        # Build API-friendly result payload similar to your sample
        result_payload = {
            "success": True,
            "unique_id": str(job_id),
            "detection_count": len(detections),
            "detections": detections,
            "image_width": meta.get("image_width"),
            "image_height": meta.get("image_height"),
        }

        with transaction.atomic():
            job = DetectionJob.objects.select_for_update().get(id=job_id)
            job.result = json.dumps(result_payload)
            job.labels_file = labels_rel_path
            job.annotated_image = annotated_image_rel_path
            job.status = "DONE"
            job.progress = 100
            job.save(update_fields=["result", "labels_file", "annotated_image", "status", "progress"])

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