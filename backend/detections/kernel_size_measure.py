# ================================================================
# ArUco + YOLO-OBB + (optional) SAM: Metric L×W and Area (mm²)
# Requirements:
#   pip install ultralytics opencv-contrib-python numpy pandas
#   # (Optional, for SAM)
#   pip install git+https://github.com/facebookresearch/segment-anything.git torch
# ================================================================

from __future__ import annotations
import os
from pathlib import Path
from typing import List, Tuple, Dict, Optional

import numpy as np
import pandas as pd
import cv2
from PIL import Image, ImageOps

# YOLO OBB
from ultralytics import YOLO

# Try to import SAM
try:
    from segment_anything import sam_model_registry, SamPredictor
    import torch
    _HAS_SAM = True
except Exception:
    _HAS_SAM = False


# ------------------------------ ArUco helpers ------------------------------

def _detector_params(min_perim_rate: float = 0.06) -> cv2.aruco.DetectorParameters:
    p = cv2.aruco.DetectorParameters()
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    p.minMarkerPerimeterRate = float(min_perim_rate)
    p.maxMarkerPerimeterRate = 4.0
    p.polygonalApproxAccuracyRate = 0.02
    p.minCornerDistanceRate = 0.05
    p.minDistanceToBorder = 3
    p.markerBorderBits = 1
    p.adaptiveThreshWinSizeMin = 5
    p.adaptiveThreshWinSizeMax = 45
    p.adaptiveThreshWinSizeStep = 5
    p.adaptiveThreshConstant = 7
    return p


def _eq_blur_gray(bgr: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    g = cv2.equalizeHist(g)
    g = cv2.GaussianBlur(g, (3, 3), 0)
    return g


def detect_allowed_ids(gray: np.ndarray,
                       allowed_ids: set[int],
                       upscale: float = 1.6) -> Tuple[List[np.ndarray], List[int]]:
    """Detect ArUco ORIGINAL markers and keep only allowed IDs."""
    params = _detector_params()
    adict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_ORIGINAL)
    det = cv2.aruco.ArucoDetector(adict, params)

    def _detect(img_gray):
        c, i, _ = det.detectMarkers(img_gray)
        if i is None or len(i) == 0:
            return [], []
        i = i.flatten().astype(int).tolist()
        keep = [k for k, idv in enumerate(i) if idv in allowed_ids]
        return [c[idx] for idx in keep], [i[idx] for idx in keep]

    c1, i1 = _detect(gray)
    c2, i2 = _detect(_eq_blur_gray(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)))
    h, w = gray.shape[:2]
    up = cv2.resize(gray, (int(w * upscale), int(h * upscale)), interpolation=cv2.INTER_CUBIC)
    c3, i3 = _detect(up)
    c3 = [c / upscale for c in c3]

    corners_all = c1 + c2 + c3
    ids_all = i1 + i2 + i3

    # Deduplicate by ID
    seen = set()
    corners_out, ids_out = [], []
    for c, idv in zip(corners_all, ids_all):
        if idv not in seen:
            seen.add(idv)
            corners_out.append(c)
            ids_out.append(idv)
    return corners_out, ids_out


def homographies_from_markers(corners_list: List[np.ndarray], side_mm: float) -> List[np.ndarray]:
    """Build homography mapping image px -> metric (mm) square of the marker."""
    Hs = []
    tgt = np.array([[0, 0], [side_mm, 0], [side_mm, side_mm], [0, side_mm]], dtype=np.float32)
    for c in corners_list:
        src = c.reshape(-1, 2).astype(np.float32)
        H, _ = cv2.findHomography(src, tgt, method=0)
        if H is not None:
            Hs.append(H)
    return Hs


def warp_pts_mm(pts_px: np.ndarray, H: np.ndarray) -> np.ndarray:
    """Warp (N,2) pixel coords to metric (mm) using homography."""
    pts = np.asarray(pts_px, dtype=np.float32).reshape(-1, 1, 2)
    out = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
    return out


# ------------------------------ YOLO OBB I/O ------------------------------

def run_yolo_obb(image_path: str, model_path: str) -> List[Dict]:
    model = YOLO(model_path)
    # Apply EXIF transpose to match frontend display
    with Image.open(image_path) as img:
        img_transposed = ImageOps.exif_transpose(img).convert("RGB")
        results = model.predict(source=img_transposed, save=False, verbose=False)
    obb_results = []
    for result in results:
        if result.obb is None:
            continue
        coords = result.obb.xywhr  # not used
        quads = result.obb.xyxyxyxy  # absolute px
        classes = result.obb.cls.cpu().numpy().astype(int).reshape(-1)
        confs = result.obb.conf.cpu().numpy().reshape(-1)
        q_np = quads.cpu().numpy().reshape(-1, 8)
        for i in range(len(classes)):
            obb_results.append({
                "cls": classes[i],
                "conf": float(confs[i]),
                "quad": q_np[i].reshape(4, 2).astype(np.float32)
            })
    return obb_results


def write_yolo_txt(obbs: List[Dict],
                   image_path: str,
                   out_dir: str,
                   coord_precision: int = 6,
                   conf_precision: int = 4) -> str:
    """Write YOLO-OBB-style label (class conf x1 y1 ... x4 y4) normalized."""
    os.makedirs(out_dir, exist_ok=True)
    base_name = Path(image_path).stem
    label_path = os.path.join(out_dir, f"{base_name}.txt")

    img = cv2.imread(image_path)
    H, W = img.shape[:2]

    with open(label_path, 'w') as f:
        for obb in obbs:
            cls = int(obb["cls"])
            conf = float(obb["conf"])
            quad = obb["quad"].copy()
            quad_norm = quad.copy()
            quad_norm[:, 0] /= W
            quad_norm[:, 1] /= H
            s_coords = [f"{x:.{coord_precision}f}" for x in quad_norm.flatten()]
            s_conf = f"{conf:.{conf_precision}f}"
            f.write(f"{cls} {s_conf} " + " ".join(s_coords) + "\n")
    return label_path


def yolo_obb_read(path: str, W: int, H: int,
                  normalized: bool = True, has_conf: bool = True) -> List[Dict]:
    out = []
    with open(path, "r") as f:
        for li, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            toks = line.split()
            try:
                if has_conf:
                    cls = int(float(toks[0])); conf = float(toks[1]); coords = list(map(float, toks[2:10]))
                else:
                    cls = int(float(toks[0])); conf = 1.0; coords = list(map(float, toks[1:9]))
            except Exception:
                continue
            quad = np.array(coords, dtype=np.float32).reshape(4, 2)
            if normalized:
                quad[:, 0] *= W; quad[:, 1] *= H
            out.append({"idx": li, "cls": cls, "conf": conf, "quad_px": quad})
    return out


# ------------------------------ Geometry helpers ------------------------------

def quad_length_width_mm(quad_mm: np.ndarray) -> Tuple[float, float]:
    q = np.asarray(quad_mm, dtype=np.float32)
    edges = [np.linalg.norm(q[i] - q[(i + 1) % 4]) for i in range(4)]
    L = float(max(edges)); W = float(min(edges))
    return L, W


def sanitize_quad(quad_px: np.ndarray) -> np.ndarray:
    q = np.asarray(quad_px, np.float32).reshape(-1, 1, 2)
    rect = cv2.minAreaRect(q)
    return cv2.boxPoints(rect).astype(np.float32)


def polygon_area_mm2(poly_mm: np.ndarray) -> float:
    """Area of mm-space polygon (N,2) using OpenCV (expects (N,1,2))."""
    if poly_mm is None or len(poly_mm) < 3:
        return 0.0
    return float(cv2.contourArea(poly_mm.reshape(-1, 1, 2).astype(np.float32)))


# ------------------------------ SAM helpers ------------------------------

SAM_BOX_EXPAND_PX = 8            # pad OBB box before prompting
SAM_MIN_CONTOUR_AREA_PX = 40     # ignore tiny blobs
SAM_ERODE_ITERATIONS = 1         # light denoise
SAM_ERODE_KERNEL_SIZE = 3
SAM_IMAGE_DOWNSCALE = 1.0        # keep 1.0 unless image is huge
SAM_USE_MULTIMASK = False

def load_sam_predictor(checkpoint_path: str, model_type: str = "vit_b") -> Optional[SamPredictor]:
    if not _HAS_SAM:
        return None
    sam = sam_model_registry[model_type](checkpoint=checkpoint_path)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sam.to(device=device)
    return SamPredictor(sam)


def _largest_contour(mask: np.ndarray) -> Optional[np.ndarray]:
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    return max(cnts, key=cv2.contourArea)


def _simplify_contour(cnt: np.ndarray, eps: float = 2.0) -> np.ndarray:
    peri = cv2.arcLength(cnt, True)
    return cv2.approxPolyDP(cnt, max(eps, 0.0), True)


def _two_points_on_quad_long_axis(quad_px: np.ndarray) -> np.ndarray:
    """Center + midpoint along the long diagonal/edge pair."""
    q = quad_px.reshape(-1, 2).astype(np.float32)
    dists = {(i, j): np.linalg.norm(q[i] - q[j]) for i in range(4) for j in range(i + 1, 4)}
    (i, j) = max(dists, key=dists.get)
    return np.stack([q.mean(axis=0), (q[i] + q[j]) / 2.0], axis=0)  # (2,2)


def _xyxy_from_quad(quad: np.ndarray) -> List[float]:
    x1, y1 = float(np.min(quad[:, 0])), float(np.min(quad[:, 1]))
    x2, y2 = float(np.max(quad[:, 0])), float(np.max(quad[:, 1]))
    return [x1, y1, x2, y2]


def _expand_box_xyxy(box: List[float], w: int, h: int, pad: int = 0) -> List[float]:
    x1, y1, x2, y2 = box
    return [max(0, x1 - pad), max(0, y1 - pad), min(w - 1, x2 + pad), min(h - 1, y2 + pad)]


def refine_quads_with_sam(img_bgr: np.ndarray,
                          quad_list: List[np.ndarray],
                          predictor: Optional[SamPredictor],
                          scale_factor: float = 1.0) -> Tuple[List[Optional[np.ndarray]], List[Optional[np.ndarray]]]:
    """Return refined quads (minAreaRect on SAM mask) and the masks."""
    if predictor is None or not quad_list:
        return [None] * len(quad_list), [None] * len(quad_list)

    H0, W0 = img_bgr.shape[:2]
    if scale_factor != 1.0:
        Hs = int(H0 * scale_factor); Ws = int(W0 * scale_factor)
        img_sam = cv2.resize(img_bgr, (Ws, Hs), interpolation=cv2.INTER_LINEAR)
    else:
        img_sam = img_bgr
        Hs, Ws = H0, W0

    img_rgb = cv2.cvtColor(img_sam, cv2.COLOR_BGR2RGB)
    predictor.set_image(img_rgb)

    refined_quads, masks = [], []
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SAM_ERODE_KERNEL_SIZE, SAM_ERODE_KERNEL_SIZE))

    for quad in quad_list:
        quad_s = quad * scale_factor if scale_factor != 1.0 else quad
        box = _expand_box_xyxy(_xyxy_from_quad(quad_s), Ws, Hs, pad=int(SAM_BOX_EXPAND_PX * scale_factor))
        box_np = np.array(box, dtype=np.float32)
        pts = _two_points_on_quad_long_axis(quad_s).astype(np.float32)
        labels = np.array([1, 1], dtype=np.int32)

        try:
            masks_pred, scores, _ = predictor.predict(
                point_coords=pts,
                point_labels=labels,
                box=box_np[None, :],
                multimask_output=SAM_USE_MULTIMASK
            )
        except Exception:
            masks_pred, scores = None, None

        if masks_pred is None or len(masks_pred) == 0:
            refined_quads.append(None); masks.append(None); continue

        k = int(np.argmax(scores))
        m = masks_pred[k].astype(np.uint8)

        if SAM_ERODE_ITERATIONS > 0:
            m = cv2.erode(m, kernel, iterations=SAM_ERODE_ITERATIONS)

        # Skip super small blobs
        cnt = _largest_contour(m)
        if cnt is None or cv2.contourArea(cnt) < SAM_MIN_CONTOUR_AREA_PX:
            refined_quads.append(None); masks.append(None); continue

        rect = cv2.minAreaRect(cnt)
        box4 = cv2.boxPoints(rect).astype(np.float32)
        if scale_factor != 1.0:
            box4 = box4 / scale_factor
        refined_quads.append(box4)
        # store a full-size mask (same size as original image)
        if (Hs, Ws) != (H0, W0):
            m = cv2.resize(m, (W0, H0), interpolation=cv2.INTER_NEAREST)
        masks.append(m)

    return refined_quads, masks


def draw_mask_overlay(vis_bgr: np.ndarray, mask: np.ndarray,
                      edge_bgr: Tuple[int, int, int] = (0, 255, 255),
                      alpha: float = 0.3,
                      thickness: int = 2) -> np.ndarray:
    """Translucent fill + crisp edge from a binary mask."""
    if mask is None:
        return vis_bgr
    cnt = _largest_contour(mask)
    if cnt is None:
        return vis_bgr
    overlay = vis_bgr.copy()
    cv2.drawContours(overlay, [cnt], -1, edge_bgr, thickness=cv2.FILLED)
    cv2.addWeighted(overlay, alpha, vis_bgr, 1 - alpha, 0, vis_bgr)
    cv2.drawContours(vis_bgr, [cnt], -1, edge_bgr, thickness)
    return vis_bgr


def contour_area_mm2_from_mask(mask: np.ndarray, Hs: List[np.ndarray]) -> float:
    """Warp mask contour(s) to mm space and compute area in mm² (median across Hs)."""
    if mask is None:
        return 0.0
    cnt = _largest_contour(mask)
    if cnt is None or cv2.contourArea(cnt) < SAM_MIN_CONTOUR_AREA_PX:
        return 0.0
    cnt = _simplify_contour(cnt, eps=2.0)  # smooth jaggies
    pts_px = cnt.reshape(-1, 2).astype(np.float32)

    areas = []
    for H in Hs:
        pts_mm = warp_pts_mm(pts_px, H)  # (N,2)
        a = polygon_area_mm2(pts_mm)
        if a > 0:
            areas.append(a)
    return float(np.median(areas)) if areas else 0.0


# ------------------------------ Pipelines ------------------------------

def run_aruco_nosam(image_path: str,
                    pred_path: str,
                    sidemm: float,
                    allowed_ids: set[int],
                    output_dir: str) -> Tuple[str, str]:
    img = cv2.imread(image_path)
    if img is None:
        raise RuntimeError(f"Failed to read image: {image_path}")
    H_img, W_img = img.shape[:2]

    dets = yolo_obb_read(pred_path, W_img, H_img, normalized=True, has_conf=True)
    corners_sel, ids_sel = detect_allowed_ids(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), allowed_ids)
    if not corners_sel:
        raise RuntimeError("No allowed ArUco markers found.")
    Hs = homographies_from_markers(corners_sel, sidemm)

    vis = img.copy()
    rows = []
    for d in dets:
        quad_px = sanitize_quad(d["quad_px"])  # keep geometry stable
        cpx = np.mean(quad_px, axis=0)

        Ls, Ws, centersmm = [], [], []
        for H in Hs:
            quad_mm = warp_pts_mm(quad_px, H)
            L, W = quad_length_width_mm(quad_mm)
            Ls.append(L); Ws.append(W); centersmm.append(np.mean(quad_mm, axis=0))
        if not Ls:
            continue

        Lmed, Wmed = float(np.median(Ls)), float(np.median(Ws))
        center = np.median(np.vstack(centersmm), axis=0)

        # Overlay
        poly = quad_px.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(vis, [poly], True, (255, 0, 0), 2)
        cpxi = tuple(np.round(cpx).astype(int))
        cv2.putText(vis, f"{Lmed:.1f}x{Wmed:.1f} mm", cpxi, cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2)
        cv2.putText(vis, str(d["idx"]), (cpxi[0], cpxi[1] + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)

        rows.append({
            "pred_idx": d["idx"], "class": d["cls"], "conf": float(d["conf"]),
            "length_mm": Lmed, "width_mm": Wmed,
            "area_mm2": np.nan,  # area not computed without SAM
            "center_x_mm": float(center[0]), "center_y_mm": float(center[1])
        })

    os.makedirs(output_dir, exist_ok=True)
    base = Path(image_path).stem
    csv_path = os.path.join(output_dir, f"{base}_seed_measurements_mm.csv")
    overlay_path = os.path.join(output_dir, f"{base}_overlay_mm.png")
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    cv2.imwrite(overlay_path, vis)
    return csv_path, overlay_path


def run_aruco_sam(image_path: str,
                  pred_path: str,
                  sam_checkpoint_path: str,
                  sam_model_type: str,
                  sidemm: float,
                  allowed_ids: set[int],
                  output_dir: str) -> Tuple[str, str]:
    if not _HAS_SAM:
        raise ImportError("segment_anything not installed")

    predictor = load_sam_predictor(sam_checkpoint_path, sam_model_type)
    img = cv2.imread(image_path)
    if img is None:
        raise RuntimeError(f"Failed to read image: {image_path}")
    H_img, W_img = img.shape[:2]

    corners_sel, ids_sel = detect_allowed_ids(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), allowed_ids)
    if not corners_sel:
        raise RuntimeError("No allowed ArUco markers found.")
    Hs = homographies_from_markers(corners_sel, sidemm)

    dets = yolo_obb_read(pred_path, W_img, H_img, normalized=True, has_conf=True)

    # SAM refinement
    quad_list = [d["quad_px"] for d in dets]
    refined_quads, refined_masks = refine_quads_with_sam(img, quad_list, predictor, scale_factor=SAM_IMAGE_DOWNSCALE)

    vis = img.copy()
    rows = []
    for i, d in enumerate(dets):
        quad_px = refined_quads[i] if (i < len(refined_quads) and refined_quads[i] is not None) else d["quad_px"]
        quad_px = sanitize_quad(quad_px)
        cpx = np.mean(quad_px, axis=0)

        # L×W in mm via homographies
        Ls, Ws, centersmm = [], [], []
        for H in Hs:
            quad_mm = warp_pts_mm(quad_px, H)
            L, W = quad_length_width_mm(quad_mm)
            Ls.append(L); Ws.append(W); centersmm.append(np.mean(quad_mm, axis=0))
        if not Ls:
            continue
        Lmed, Wmed = float(np.median(Ls)), float(np.median(Ws))
        center = np.median(np.vstack(centersmm), axis=0)

        # Area from SAM mask (true mm²)
        mask = refined_masks[i] if i < len(refined_masks) else None
        seed_area_mm2 = contour_area_mm2_from_mask(mask, Hs) if mask is not None else 0.0

        # Overlay: mask + thin quad
        if mask is not None:
            vis = draw_mask_overlay(vis, mask, edge_bgr=(0, 255, 255), alpha=0.25, thickness=2)
        poly = quad_px.astype(int).reshape(-1, 1, 2)
        cv2.polylines(vis, [poly], True, (255, 0, 0), 1)

        cpxi = tuple(np.round(cpx).astype(int))
        cv2.putText(vis, f"{seed_area_mm2:.2f} mm^2", (cpxi[0], cpxi[1] - 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
        cv2.putText(vis, f"{Lmed:.1f}x{Wmed:.1f} mm", cpxi,
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2)
        cv2.putText(vis, str(d["idx"]), (cpxi[0], cpxi[1] + 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)

        rows.append({
            "pred_idx": d["idx"], "class": d["cls"], "conf": float(d["conf"]),
            "length_mm": Lmed, "width_mm": Wmed, "area_mm2": float(seed_area_mm2),
            "center_x_mm": float(center[0]), "center_y_mm": float(center[1])
        })

    os.makedirs(output_dir, exist_ok=True)
    base = Path(image_path).stem
    csv_path = os.path.join(output_dir, f"{base}_seed_measurements_mm_sam.csv")
    overlay_path = os.path.join(output_dir, f"{base}_overlay_mm_sam.png")
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    cv2.imwrite(overlay_path, vis)
    return csv_path, overlay_path


# ------------------------------ Orchestrator ------------------------------

def process_image(image_path: str,
                  yolo_model_path: str,
                  sam_checkpoint_path: Optional[str] = None,
                  use_sam: bool = False,
                  sam_model_type: str = "vit_b",
                  min_confidence: float = 0.30,
                  sidemm: float = 40.0,
                  allowed_ids: Optional[set[int]] = None,
                  output_dir: str = "./out") -> Dict[str, str]:
    """
    High-level pipeline:
      1) YOLO OBB detect → write normalized labels file (class conf x1..y4)
      2) ArUco → homographies (px→mm)
      3) If SAM: refine, overlay mask, area in mm²; else L×W only
    """
    if allowed_ids is None:
        allowed_ids = {425, 100, 201, 310}

    # 1) YOLO
    preds = run_yolo_obb(image_path, yolo_model_path)
    preds = [p for p in preds if p["conf"] >= min_confidence]
    labels_path = write_yolo_txt(preds, image_path, output_dir)

    # 2/3) Measure
    if use_sam:
        if not sam_checkpoint_path:
            raise ValueError("use_sam=True but no sam_checkpoint_path provided.")
        csv_path, overlay_path = run_aruco_sam(
            image_path=image_path,
            pred_path=labels_path,
            sam_checkpoint_path=sam_checkpoint_path,
            sam_model_type=sam_model_type,
            sidemm=sidemm,
            allowed_ids=allowed_ids,
            output_dir=output_dir
        )
    else:
        csv_path, overlay_path = run_aruco_nosam(
            image_path=image_path,
            pred_path=labels_path,
            sidemm=sidemm,
            allowed_ids=allowed_ids,
            output_dir=output_dir
        )

    return {
        "obb_label_path": labels_path,
        "measurement_csv_path": csv_path,
        "overlay_image_path": overlay_path
    }


# ------------------------------ CLI ------------------------------

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("image_path")
    ap.add_argument("yolo_model_path")
    ap.add_argument("--sam_checkpoint", default=None)
    ap.add_argument("--use_sam", action="store_true")
    ap.add_argument("--sam_model_type", default="vit_b")
    ap.add_argument("--min_confidence", type=float, default=0.30)
    ap.add_argument("--sidemm", type=float, default=40.0)
    ap.add_argument("--allowed_ids", type=str, default="425,100,201,310",
                    help="Comma-separated ArUco ORIGINAL IDs to accept.")
    ap.add_argument("--output_dir", default="./out")
    args = ap.parse_args()

    allowed = {int(x) for x in args.allowed_ids.split(",") if x.strip()}
    res = process_image(
        image_path=args.image_path,
        yolo_model_path=args.yolo_model_path,
        sam_checkpoint_path=args.sam_checkpoint,
        use_sam=args.use_sam,
        sam_model_type=args.sam_model_type,
        min_confidence=args.min_confidence,
        sidemm=args.sidemm,
        allowed_ids=allowed,
        output_dir=args.output_dir,
    )
    print("Done.")
    print(res)
