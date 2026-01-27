# detections/inference.py
from typing import List, Dict, Any, Tuple
from PIL import Image, ImageOps
import numpy as np
from ultralytics import YOLO

# Use the centralized model loader and results normalization
from .detect_models import load_model, results_to_response
from .detection_cache import load_detection_cache, store_detection_cache, sha256_file

# A simple in-memory cache for models
_model_cache: Dict[str, YOLO] = {}


def _get_model(model_name: str) -> YOLO:
    """
    Lazy-load and cache the model using the central registry.
    """
    if model_name not in _model_cache:
        # load_model() handles file existence and model loading
        _model_cache[model_name] = load_model(model_name)
    return _model_cache[model_name]


def _image_dims(path: str) -> Tuple[int, int]:
    """Return (width,height) using PIL, falling back to (0,0) on error."""
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


def run_detection(
    image_path: str,
    confidence: float = 0.25,
    model_name: str = "spike",
    image_digest: str = "",
    use_cache: bool = True,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """
    Dynamically loads and runs detection with the specified model.

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
    model = _get_model(model_name)
    max_det = 5000

    digest = image_digest or (sha256_file(image_path) if use_cache else "")
    cached_payload = None
    if use_cache and digest:
        cached_payload = load_detection_cache(model_name, confidence, digest)

    if cached_payload is not None:
        normalized_result = cached_payload
    else:
        # Load image and apply EXIF transpose to match frontend display
        with Image.open(image_path) as img:
            img_transposed = ImageOps.exif_transpose(img).convert("RGB")
            # Run prediction and get results
            results = model.predict(source=img_transposed, conf=confidence, verbose=False, max_det=max_det)
            # Use the shared results_to_response function to normalize the output
            normalized_result = results_to_response(results[0])
        if use_cache and digest:
            try:
                store_detection_cache(model_name, confidence, digest, normalized_result)
            except Exception:
                pass

    # Modify the output to match the expected format for the async task
    detections = []
    for d in normalized_result.get("detections", []):
        detections.append({
            "class": d["class"],
            "class_id": d.get("class_id"),
            "confidence": d["confidence"],
            "polygon": d["poly"],
        })

    meta = {
        "image_width": normalized_result.get("image_width", 0),
        "image_height": normalized_result.get("image_height", 0)
    }
    
    return detections, meta
