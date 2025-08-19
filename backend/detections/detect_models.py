# detections/detect_models.py  — FULL FILE REPLACEMENT
import os
from functools import lru_cache
from typing import Dict, Any, List, Iterable

import numpy as np
from ultralytics import YOLO

APP_DIR = os.path.dirname(__file__)

def _fallback(fname: str) -> str:
    """Prefer app-local detections/models/<fname>; else /app/models/<fname>."""
    local = os.path.join(APP_DIR, "models", fname)
    return local if os.path.exists(local) else f"/app/models/{fname}"

# Front-end keys -> weight paths (env overrides > fallback)
MODEL_REGISTRY: Dict[str, str] = {
    "spike":     os.getenv("MODEL_SPIKE",     _fallback("spike.pt")),
    "spikelet":  os.getenv("MODEL_SPIKELET",  _fallback("spikelet.pt")),
    "fhb":       os.getenv("MODEL_FHB",       _fallback("fhb.pt")),
    "fdk":       os.getenv("MODEL_FDK",       _fallback("fdk.pt")),
    "third":     os.getenv("MODEL_THIRD",     _fallback("third.pt")),
}

@lru_cache(maxsize=None)
def load_model(model_name: str) -> YOLO:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model '{model_name}'. Valid: {list(MODEL_REGISTRY)}")
    path = MODEL_REGISTRY[model_name]
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model weights not found: {path}")
    return YOLO(path)

# ------------ helpers to coerce shapes safely ------------

def _scalar(x):
    """Return a Python float/int from tensors/ndarrays/lists of shape (1,) or (1,1)."""
    if x is None:
        return None
    if isinstance(x, (float, int)):
        return x
    try:
        arr = np.asarray(x)
        if arr.size == 0:
            return None
        return arr.reshape(-1)[0].item()
    except Exception:
        # last ditch: try float() directly
        try:
            return float(x)
        except Exception:
            return None

def _flatten_poly(poly_like) -> List[float]:
    """
    Accepts:
      - [x1,y1,...,x4,y4] (len=8)
      - [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] (4x2)
      - numpy/tensor equivalents
    Returns flat [x1,y1,...,x4,y4] as floats.
    """
    arr = np.asarray(poly_like).astype(float)
    if arr.size == 8:
        return arr.reshape(-1).tolist()
    if arr.shape == (4, 2) or arr.shape == (2, 4):
        return arr.reshape(-1).tolist()
    # Some variants use (N,8) row — already fine
    return arr.reshape(-1).tolist()

def _xyxy_to_poly(x1, y1, x2, y2) -> List[float]:
    return [float(x1), float(y1), float(x2), float(y1), float(x2), float(y2), float(x1), float(y2)]

def _rbox_to_poly(cx, cy, w, h, angle_rad) -> List[float]:
    hx, hy = w/2.0, h/2.0
    c, s = float(np.cos(angle_rad)), float(np.sin(angle_rad))
    pts = [(-hx,-hy),(hx,-hy),(hx,hy),(-hx,hy)]
    out: List[float] = []
    for px,py in pts:
        rx = px*c - py*s
        ry = px*s + py*c
        out += [float(cx+rx), float(cy+ry)]
    return out

# ------------ normalization ------------

def results_to_response(result: Any) -> Dict[str, Any]:
    ih, iw = result.orig_shape[:2]
    out: Dict[str, Any] = {"image_width": int(iw), "image_height": int(ih), "detections": []}

    # Prefer OBB first (Ultralytics OBB task)
    obb = getattr(result, "obb", None)
    if obb is not None:
        # Case 1: xyxyxyxy (N,8) or (N,4,2)
        polys = getattr(obb, "xyxyxyxy", None)
        if polys is not None:
            polys = polys.cpu().numpy() if hasattr(polys, "cpu") else polys
            confs = getattr(obb, "conf", None)
            confs = confs.cpu().numpy() if hasattr(confs, "cpu") else confs
            clss  = getattr(obb, "cls", None)
            clss  = clss.cpu().numpy() if hasattr(clss, "cpu") else clss

            num = len(polys)
            for i in range(num):
                p = _flatten_poly(polys[i])
                c = _scalar(confs[i]) if confs is not None else 0.0
                k = _scalar(clss[i]) if clss  is not None else None
                out["detections"].append({
                    "class": str(int(k)) if k is not None else "obj",
                    "class_id": int(k) if k is not None else None,
                    "confidence": float(c) if c is not None else 0.0,
                    "poly": p,
                })
            return out

        # Case 2: xywhr (N,5): center x,y,w,h,angle(rad)
        xywhr = getattr(obb, "xywhr", None)
        if xywhr is not None:
            xywhr = xywhr.cpu().numpy() if hasattr(xywhr, "cpu") else xywhr
            confs = getattr(obb, "conf", None)
            confs = confs.cpu().numpy() if hasattr(confs, "cpu") else confs
            clss  = getattr(obb, "cls", None)
            clss  = clss.cpu().numpy() if hasattr(clss, "cpu") else clss

            num = len(xywhr)
            for i in range(num):
                cx, cy, w, h, r = [float(v) for v in np.asarray(xywhr[i]).reshape(-1)[:5]]
                p = _rbox_to_poly(cx, cy, w, h, r)
                c = _scalar(confs[i]) if confs is not None else 0.0
                k = _scalar(clss[i]) if clss  is not None else None
                out["detections"].append({
                    "class": str(int(k)) if k is not None else "obj",
                    "class_id": int(k) if k is not None else None,
                    "confidence": float(c) if c is not None else 0.0,
                    "poly": p,
                })
            return out

    # Fallback: axis-aligned boxes
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        xyxy = getattr(boxes, "xyxy", None)
        conf = getattr(boxes, "conf", None)
        cls  = getattr(boxes, "cls", None)
        if xyxy is not None:
            xyxy = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else xyxy
            conf = conf.cpu().numpy() if hasattr(conf, "cpu") else conf
            cls  = cls.cpu().numpy() if hasattr(cls, "cpu") else cls

            num = len(xyxy)
            for i in range(num):
                x1, y1, x2, y2 = [float(v) for v in np.asarray(xyxy[i]).reshape(-1)[:4]]
                c = _scalar(conf[i]) if conf is not None else 0.0
                k = _scalar(cls[i]) if cls  is not None else None
                out["detections"].append({
                    "class": str(int(k)) if k is not None else "obj",
                    "class_id": int(k) if k is not None else None,
                    "confidence": float(c) if c is not None else 0.0,
                    "poly": _xyxy_to_poly(x1, y1, x2, y2),
                })
    return out

def run_inference(model_name: str, image_pil, conf: float = 0.05) -> Dict[str, Any]:
    model = load_model(model_name)
    results = model.predict(image_pil, conf=conf, verbose=False)
    return results_to_response(results[0])
