import os
import sys
import uuid
import json
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Sequence

from django.conf import settings


def _candidate_model_dirs() -> List[Path]:
    """
    Possible parent folders that may contain FHBmodels/.
    Priority: explicit env -> backend/models -> repo_root/models -> /app/models -> /models.
    """
    env_root = os.environ.get("FHB_FIELD_ROOT")
    candidates: List[Path] = []
    if env_root:
        candidates.append(Path(env_root))

    base = Path(settings.BASE_DIR)
    candidates.extend([
        base / "models",
        base.parent / "models",
        Path("/app/models"),
        Path("/models"),
    ])
    seen = []
    deduped: List[Path] = []
    for cand in candidates:
        if not cand:
            continue
        key = str(cand.resolve())
        if key in seen:
            continue
        seen.append(key)
        deduped.append(cand)
    return deduped


def _resolve_fhb_root() -> Path:
    """
    Locate the FHBmodels directory that ships the pipeline code + weights.
    """
    tried: List[str] = []
    for cand in _candidate_model_dirs():
        cand = cand.expanduser()
        fhb = cand / "FHBmodels" if cand.name != "FHBmodels" else cand
        if fhb.exists():
            return fhb.resolve()
        tried.append(str(fhb))
    raise FileNotFoundError(
        "FHBmodels directory not found. "
        f"Checked: {', '.join(tried)}. "
        "Set FHB_FIELD_ROOT or place models under ./models/FHBmodels."
    )


def _ensure_syspath(fhb_root: Path) -> None:
    """
    Allow 'import FHBmodels.*' by putting its parent on sys.path.
    """
    parent = fhb_root.parent
    if parent and str(parent) not in sys.path:
        sys.path.insert(0, str(parent))


def _weight_paths(fhb_root: Path) -> Dict[str, Path]:
    paths = {
        "spike_detector": fhb_root / "spikeDetection" / "best_spike_YOLO11_freeze0_RS2.pt",
        "orientation": fhb_root / "orientationClassification" / "small_3dcnn_best.pth",
        "fhb_detector": fhb_root / "FHBdetection" / "best_FHB_field_trainKSU_fineTune.pt",
    }
    missing = [name for name, path in paths.items() if not path.exists()]
    if missing:
        details = ", ".join(f"{name}:{paths[name]}" for name in missing)
        raise FileNotFoundError(f"Missing FHB field weights: {details}")
    return paths


def _save_uploads(files: Sequence[Any], dest_dir: Path) -> List[str]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    saved: List[str] = []
    for idx, up in enumerate(files):
        fname = getattr(up, "name", None) or f"image_{idx + 1}.jpg"
        safe_name = Path(str(fname)).name or f"image_{idx + 1}.jpg"
        target = dest_dir / safe_name
        with open(target, "wb") as out:
            if hasattr(up, "chunks"):
                for chunk in up.chunks():
                    if chunk:
                        out.write(chunk)
            elif hasattr(up, "read"):
                data = up.read()
                if data:
                    out.write(data)
            elif isinstance(up, (bytes, bytearray)):
                out.write(up)
            else:
                raise ValueError(f"Unsupported upload object at index {idx}")
        saved.append(target.name)
    return saved


def _rel_to_media(path: Path) -> str | None:
    try:
        return str(path.resolve().relative_to(Path(settings.MEDIA_ROOT).resolve()))
    except Exception:
        return None


def _sample_images(dirs: List[Path], limit: int = 12, exclude_keywords: set[str] | None = None) -> List[str]:
    out: List[str] = []
    exclude_keywords = exclude_keywords or set()
    for d in dirs:
        if not d.exists():
            continue
        for p in sorted(d.glob("**/*")):
            if len(out) >= limit:
                return out
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                if any(token in p.parts for token in exclude_keywords):
                    continue
                rel = _rel_to_media(p)
                if rel:
                    out.append(rel)
    return out


def _zip_directory(src: Path, dest_dir: Path, zip_name: str) -> Path | None:
    """
    Zip all files under src into dest_dir/zip_name. Returns the zip path or None if nothing zipped.
    """
    if not src.exists():
        return None
    files = [p for p in src.rglob("*") if p.is_file()]
    if not files:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            try:
                arcname = p.relative_to(src)
            except Exception:
                arcname = p.name
            zf.write(p, arcname=arcname)
    return zip_path


def _zip_paths(sources: List[Path], dest_dir: Path, zip_name: str) -> Path | None:
    files = []
    for src in sources:
        if not src.exists():
            continue
        files.extend([(src, p) for p in src.rglob("*") if p.is_file()])
    if not files:
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for base, file_path in files:
            try:
                arcname = Path(base.name) / file_path.relative_to(base)
            except Exception:
                arcname = file_path.name
            zf.write(file_path, arcname=arcname)
    return zip_path


def run_fhb_field_pipeline(
    files: Sequence[Any],
    run_name: str | None = None,
    results_root: Path | None = None,
) -> Dict[str, Any]:
    """
    Execute the full FHB field pipeline (spike OBB -> orientation classifier -> FHB scoring).

    Parameters
    ----------
    files : list of uploaded files/bytes
        One or more images to process.
    run_name : str | None
        Optional run identifier; autogenerated if omitted.
    results_root : Path | None
        Base output directory; defaults to MEDIA_ROOT/fhb_field.

    Returns
    -------
    dict
        JSON-serializable summary including summary rows and Excel file name.
    """
    if not files:
        raise ValueError("No images provided for FHB field pipeline.")

    fhb_root = _resolve_fhb_root()
    _ensure_syspath(fhb_root)
    try:
        # Imports rely on sys.path containing fhb_root.parent
        from FHBmodels.spikeExtract import run_spike_pipeline  # type: ignore
        from FHBmodels.spikeClassification import move_good_oriented_spikes  # type: ignore
        from FHBmodels.fhbScore import fhb_detect  # type: ignore
    except Exception as e:
        raise ImportError(f"Unable to import FHB pipeline code from {fhb_root}: {e}") from e

    weights = _weight_paths(fhb_root)

    run = run_name or f"fhb_field_{uuid.uuid4().hex[:8]}"
    base_out = Path(results_root) if results_root else Path(settings.MEDIA_ROOT) / "fhb_field"
    run_root = base_out / run
    inputs_dir = run_root / "inputs"

    saved_files = _save_uploads(files, inputs_dir)

    # Stage 1: spike OBB detection + cropping
    run_spike_pipeline(
        yolo_run_name=run,
        model_path=str(weights["spike_detector"]),
        images_dir=str(inputs_dir),
        max_crops=50,
        buffer_px=30,
        clear_crops=True,
        results_root=str(base_out),
    )

    # Stage 2: orientation classification to keep only good crops
    move_good_oriented_spikes(
        run_name=run,
        model_path=str(weights["orientation"]),
        results_root=str(base_out),
        input_subdir="SpikeletCrops_30px",
        output_subdir="SpikeletCrops_30px_good",
    )

    # Choose good crops; if none, fall back to all crops
    good_subdir = "SpikeletCrops_30px_good"
    good_dir = run_root / good_subdir
    if not any(good_dir.glob("*.png")):
        fallback_dir = run_root / "SpikeletCrops_30px"
        if any(fallback_dir.glob("*.png")):
            good_subdir = "SpikeletCrops_30px"

    # Stage 3: FHB detection + aggregation
    df, excel_path = fhb_detect(
        run_name=run,
        results_root=str(base_out),
        good_spikes_subdir=good_subdir,
        fhb_model_path=str(weights["fhb_detector"]),
        non_infected_classes={0},
        infected_classes={1},
        imgsz=600,
        conf=0.25,
        save_overlays=True,
        output_excel_name="FHB_summary_per_image.xlsx",
    )

    summary_rows: List[Dict[str, Any]] = []
    if df is not None:
        if hasattr(df, "to_json"):
            try:
                summary_rows = json.loads(df.to_json(orient="records"))
            except Exception:
                try:
                    summary_rows = df.to_dict(orient="records")  # type: ignore[arg-type]
                except Exception:
                    summary_rows = []
        elif hasattr(df, "to_dict"):
            try:
                summary_rows = df.to_dict(orient="records")  # type: ignore[arg-type]
            except Exception:
                summary_rows = []

    excel_copy_name = None
    excel_copy_path = None
    if excel_path:
        reports_dir = Path(settings.MEDIA_ROOT) / "reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        excel_copy_name = f"{run}_fhb_field.xlsx"
        excel_copy_path = reports_dir / excel_copy_name
        try:
            shutil.copy(excel_path, excel_copy_path)
        except Exception:
            excel_copy_name = None
            excel_copy_path = None

    overlay_dir = run_root / good_subdir / "FHB_labels" / "pred"
    overlay_files: List[Dict[str, str]] = []
    if overlay_dir.exists():
        for f in overlay_dir.iterdir():
            if f.is_file() and f.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                rel = _rel_to_media(f)
                if rel:
                    overlay_files.append({"name": f.name, "path": rel})

    # Build download bundles
    zip_out_dir = run_root
    downloads: List[Dict[str, str]] = []

    spike_overlays_zip = _zip_directory(run_root, zip_out_dir, f"{run}_spike_detection.zip")
    if spike_overlays_zip:
        rel = _rel_to_media(spike_overlays_zip)
        if rel:
            previews = _sample_images([run_root], exclude_keywords={"SpikeletCrops", "SpikeletCrops_30px", "SpikeletCrops_30px_good"})
            downloads.append({"type": "spike_detection", "label": "Spike detection overlays/labels", "path": rel, "previews": previews})

    crops_all_zip = _zip_paths(
        [run_root / "SpikeletCrops_30px", run_root / "SpikeletCrops_30px_good"],
        zip_out_dir,
        f"{run}_crops_all.zip",
    )
    if crops_all_zip:
        rel = _rel_to_media(crops_all_zip)
        if rel:
            previews = _sample_images(
                [run_root / "SpikeletCrops_30px", run_root / "SpikeletCrops_30px_good"],
                exclude_keywords={"FHB_labels", "pred", "labels"},
            )
            downloads.append({"type": "crops_all", "label": "Cropped spikes (all)", "path": rel, "previews": previews})

    crops_good_zip = _zip_directory(run_root / "SpikeletCrops_30px_good", zip_out_dir, f"{run}_crops_good.zip")
    if crops_good_zip:
        rel = _rel_to_media(crops_good_zip)
        if rel:
            previews = _sample_images(
                [run_root / "SpikeletCrops_30px_good"],
                exclude_keywords={"FHB_labels", "pred", "labels"},
            )
            downloads.append({"type": "crops_good", "label": "Good orientation spikes", "path": rel, "previews": previews})

    crops_bad_zip = _zip_directory(run_root / "SpikeletCrops_30px", zip_out_dir, f"{run}_crops_bad_orientation.zip")
    if crops_bad_zip:
        rel = _rel_to_media(crops_bad_zip)
        if rel:
            previews = _sample_images([run_root / "SpikeletCrops_30px"], exclude_keywords={"FHB_labels", "pred", "labels"})
            downloads.append({"type": "crops_bad", "label": "Bad orientation spikes", "path": rel, "previews": previews})

    fhb_overlays_zip = _zip_directory(overlay_dir, zip_out_dir, f"{run}_fhb_overlays.zip")
    if fhb_overlays_zip:
        rel = _rel_to_media(fhb_overlays_zip)
        if rel:
            previews = _sample_images([overlay_dir])
            downloads.append({"type": "fhb_overlays", "label": "FHB detection overlays", "path": rel, "previews": previews})

    log_files: List[Dict[str, str]] = []
    for log_name in ["spikelet_extract.log", "spike_classification.log", "fhb_detection.log"]:
        p = run_root / log_name
        rel = _rel_to_media(p)
        if rel:
            log_files.append({"name": log_name, "path": rel})

    payload: Dict[str, Any] = {
        "run_name": run,
        "inputs": saved_files,
        "summary": summary_rows,
        "results_root": _rel_to_media(run_root),
        "excel_name": excel_copy_name,
        "excel_rel_path": _rel_to_media(excel_copy_path) if excel_copy_path else None,
        "logs": log_files,
        "overlays": overlay_files,
        "downloads": downloads,
        "used_good_dir": good_subdir,
    }
    return payload
