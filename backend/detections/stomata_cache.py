import hashlib
import json
import os
import shutil
from typing import Dict, Any, Optional, Tuple

from django.conf import settings

_CACHE_ROOT = os.path.join(settings.MEDIA_ROOT, "cache", "stomata")


def compute_stomata_params_hash(
    um_per_px: float,
    conf: float,
    iou: float,
    sam_checkpoint: str,
    sam_model_type: str,
) -> Tuple[str, Dict[str, Any]]:
    descriptor = {
        "um_per_px": float(um_per_px),
        "conf": float(conf),
        "iou": float(iou),
        "sam_checkpoint": (sam_checkpoint or "").strip(),
        "sam_model_type": (sam_model_type or "vit_b").strip(),
    }
    raw = json.dumps(descriptor, sort_keys=True).encode("utf-8")
    h = hashlib.sha256(raw).hexdigest()[:16]
    return h, descriptor


def _cache_json_path(image_digest: str, params_hash: str) -> str:
    fname = f"{image_digest}_{params_hash}.json"
    return os.path.join(_CACHE_ROOT, fname)


def load_stomata_cache(image_digest: str, params_hash: str) -> Optional[Dict[str, Any]]:
    if not image_digest or not params_hash:
        return None
    path = _cache_json_path(image_digest, params_hash)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except Exception:
        return None

    overlay_rel = payload.get("stomata_overlay") or ""
    excel_rel = payload.get("stomata_excel") or ""
    if overlay_rel:
        overlay_abs = os.path.join(settings.MEDIA_ROOT, overlay_rel)
        if not os.path.exists(overlay_abs):
            return None
    if excel_rel:
        excel_abs = os.path.join(settings.MEDIA_ROOT, excel_rel)
        if not os.path.exists(excel_abs):
            return None
    return payload


def store_stomata_cache(
    image_digest: str,
    params_hash: str,
    descriptor: Dict[str, Any],
    payload: Dict[str, Any],
    overlay_abs: str,
    excel_abs: str,
) -> Optional[Dict[str, Any]]:
    if not image_digest or not params_hash:
        return None
    os.makedirs(_CACHE_ROOT, exist_ok=True)

    cached_payload = dict(payload)
    cached_payload["cache"] = descriptor

    if overlay_abs and os.path.exists(overlay_abs):
        overlay_name = f"{image_digest}_{params_hash}_overlay.png"
        overlay_rel = os.path.join("cache", "stomata", overlay_name)
        overlay_out = os.path.join(settings.MEDIA_ROOT, overlay_rel)
        if not os.path.exists(overlay_out):
            shutil.copy2(overlay_abs, overlay_out)
        cached_payload["stomata_overlay"] = overlay_rel

    if excel_abs and os.path.exists(excel_abs):
        excel_name = f"{image_digest}_{params_hash}_results.xlsx"
        excel_rel = os.path.join("cache", "stomata", excel_name)
        excel_out = os.path.join(settings.MEDIA_ROOT, excel_rel)
        if not os.path.exists(excel_out):
            shutil.copy2(excel_abs, excel_out)
        cached_payload["stomata_excel"] = excel_rel

    try:
        with open(_cache_json_path(image_digest, params_hash), "w", encoding="utf-8") as fh:
            json.dump(cached_payload, fh)
    except Exception:
        return None

    return cached_payload
