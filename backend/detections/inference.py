# detections/inference.py
import os
from typing import List, Dict, Any, Tuple
from PIL import Image
import numpy as np
from ultralytics import YOLO

# Path to your OBB weights (must exist; no fallback)
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/obb_best.pt")

_model: YOLO | None = None


def _get_model() -> YOLO:
    """Lazy-load OBB model (no fallback, no extras)."""
    global _model
    if _model is not None:
        return _model
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"MODEL_PATH not found: {MODEL_PATH}. "
            "Mount your OBB weights into the container at this path."
        )
    _model = YOLO(MODEL_PATH)
    return _model


def _image_dims(path: str) -> Tuple[int, int]:
    try:
        with Image.open(path) as im:
            return im.width, im.height
    except Exception:
        return 0, 0


def _poly8(x) -> List[float]:
    """
    Flatten any tensor/np/list shape to the first 8 numbers as floats.
    Ultralytics OBB polygons are 8 values: [x1,y1,x2,y2,x3,y3,x4,y4].
    """
    flat = np.array(x).reshape(-1).tolist()
    return [float(v) for v in flat[:8]]


def run_detection(image_path: str, confidence: float = 0.25) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """
    OBB-only detection.

    Returns:
      detections: [
        {
          "class": str,
          "class_id": int,
          "confidence": float,
          "polygon": [x1,y1,x2,y2,x3,y3,x4,y4]   # pixels
        }, ...
      ]
      meta: {"image_width": int, "image_height": int}
    """
    model = _get_model()
    results = model.predict(source=image_path, conf=confidence, verbose=False, task="obb")

    detections: List[Dict[str, Any]] = []
    for r in results:
        names = r.names  # id -> name
        obb = getattr(r, "obb", None)
        if obb is None:
            continue

        xyxyxyxy = getattr(obb, "xyxyxyxy", None)
        cls = getattr(obb, "cls", None)
        confs = getattr(obb, "conf", None)
        if xyxyxyxy is None or cls is None or confs is None:
            continue

        n = int(len(cls))
        for i in range(n):
            poly = _poly8(xyxyxyxy[i])
            cid = int(cls[i])
            score = float(confs[i])
            cname = names.get(cid, str(cid)) if isinstance(names, dict) else str(cid)

            detections.append({
                "class": cname,
                "class_id": cid,
                "confidence": score,
                "polygon": [round(v, 2) for v in poly],
            })

    w, h = _image_dims(image_path)
    meta = {"image_width": w, "image_height": h}
    return detections, meta
