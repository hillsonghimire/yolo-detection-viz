import json
import hashlib
import os
import shutil
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

from django.conf import settings


_CACHE_VERSION = 1
_CACHE_ROOT = os.path.join(settings.MEDIA_ROOT, "cache", "kernel")
_MEASURE_ROOT = os.path.join(settings.MEDIA_ROOT, "measure")


def normalize_allowed_ids_csv(raw: str) -> str:
    ids: set[int] = set()
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.add(int(part))
        except ValueError:
            continue
    if not ids:
        return ""
    return ",".join(str(x) for x in sorted(ids))


def compute_kernel_params_hash(model_name: str,
                               sidemm: float,
                               allowed_ids_csv: str,
                               use_sam: bool,
                               sam_checkpoint: str,
                               sam_model_type: str) -> Tuple[str, Dict[str, Any]]:
    descriptor = {
        "model": (model_name or "kernel").strip(),
        "sidemm": float(sidemm),
        "allowed_ids_csv": allowed_ids_csv or "",
        "use_sam": bool(use_sam),
        "sam_checkpoint": (sam_checkpoint or "").strip(),
        "sam_model_type": (sam_model_type or "").strip(),
    }
    serialized = json.dumps(descriptor, sort_keys=True, separators=(",", ":"))
    params_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:32]
    return params_hash, descriptor


def _record_path(image_digest: str, params_hash: str) -> str:
    safe_digest = image_digest.strip().lower()
    safe_hash = params_hash.strip().lower()
    return os.path.join(_CACHE_ROOT, f"{safe_digest}-{safe_hash}.json")


def _ensure_measure_file(src_abs: str, image_digest: str, params_hash: str) -> Optional[str]:
    if not src_abs or not os.path.exists(src_abs):
        return None
    os.makedirs(_MEASURE_ROOT, exist_ok=True)
    src_path = Path(src_abs)
    suffix = src_path.suffix or ""
    target_name = f"{image_digest.lower()}-{params_hash.lower()}{suffix}"
    target_abs = os.path.join(_MEASURE_ROOT, target_name)
    if os.path.abspath(src_abs) != os.path.abspath(target_abs):
        if not os.path.exists(target_abs):
            try:
                shutil.copyfile(src_abs, target_abs)
            except Exception:
                return None
    rel = os.path.relpath(target_abs, settings.MEDIA_ROOT)
    return rel.replace(os.sep, "/")


def load_kernel_cache(image_digest: str, params_hash: str) -> Optional[Dict[str, Any]]:
    path = _record_path(image_digest, params_hash)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload_wrapper = json.load(fh)
    except Exception:
        return None
    if payload_wrapper.get("_version") != _CACHE_VERSION:
        return None
    payload = payload_wrapper.get("payload")
    if not isinstance(payload, dict):
        return None
    csv_rel = payload.get("measurement_csv")
    overlay_rel = payload.get("measurement_overlay")
    if csv_rel:
        csv_abs = os.path.join(settings.MEDIA_ROOT, csv_rel)
        if not os.path.exists(csv_abs):
            return None
    if overlay_rel:
        overlay_abs = os.path.join(settings.MEDIA_ROOT, overlay_rel)
        if not os.path.exists(overlay_abs):
            return None
    return payload


def store_kernel_cache(image_digest: str,
                       params_hash: str,
                       descriptor: Dict[str, Any],
                       payload: Dict[str, Any],
                       csv_abs: Optional[str],
                       overlay_abs: Optional[str]) -> Optional[Dict[str, Any]]:
    try:
        os.makedirs(_CACHE_ROOT, exist_ok=True)
    except Exception:
        return None

    payload_copy = dict(payload)
    csv_rel = _ensure_measure_file(csv_abs, image_digest, params_hash) if csv_abs else None
    overlay_rel = _ensure_measure_file(overlay_abs, image_digest, params_hash) if overlay_abs else None

    if csv_rel:
        payload_copy["measurement_csv"] = csv_rel
    if overlay_rel:
        payload_copy["measurement_overlay"] = overlay_rel

    record = {
        "_version": _CACHE_VERSION,
        "payload": payload_copy,
        "descriptor": descriptor,
    }

    tmp_dir = os.path.dirname(_record_path(image_digest, params_hash))
    os.makedirs(tmp_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="kernel-cache-", suffix=".json", dir=tmp_dir)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(record, fh)
        os.replace(tmp_path, _record_path(image_digest, params_hash))
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return None

    return payload_copy
