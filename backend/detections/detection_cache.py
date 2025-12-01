import os
import json
import hashlib
import tempfile
from typing import Any, Dict, Optional

from django.conf import settings

# Stored cache payloads include a version wrapper so we can invalidate cleanly.
_CACHE_VERSION = 1
_CACHE_ROOT = os.path.join(settings.MEDIA_ROOT, "cache", "basic")


def _cache_conf_key(conf: float) -> str:
    value = f"{float(conf):.6f}"
    value = value.rstrip("0").rstrip(".")
    return value or "0"


def _cache_path(model_name: str, conf: float, digest: str) -> str:
    safe_model = "".join(c if c.isalnum() or c in {"-", "_", "."} else "_" for c in str(model_name or "default"))
    return os.path.join(_CACHE_ROOT, safe_model, f"{_cache_conf_key(conf)}-{digest}.json")


def sha256_bytes(raw: bytes) -> str:
    if not raw:
        return ""
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""


def load_detection_cache(model_name: str, conf: float, digest: str) -> Optional[Dict[str, Any]]:
    """
    Read a cached detection payload if it exists and the version matches.
    Returns None when no usable cache is present.
    """
    if not digest:
        return None
    path = _cache_path(model_name, conf, digest)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload_wrapper = json.load(fh)
        if payload_wrapper.get("_version") != _CACHE_VERSION:
            return None
        payload = payload_wrapper.get("payload")
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


def store_detection_cache(model_name: str, conf: float, digest: str, payload: Dict[str, Any]) -> None:
    """
    Persist a detection payload to disk using an atomic replace.
    Failures are swallowed so detection responses still return successfully.
    """
    if not digest:
        return
    path = _cache_path(model_name, conf, digest)
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="cache-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"_version": _CACHE_VERSION, "payload": payload}, fh)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
