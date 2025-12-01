from ultralytics import YOLO
from pathlib import Path
from math import sqrt, hypot
from PIL import Image, ImageDraw
import random
import logging

IMAGE_EXTS = [".jpg", ".JPG", ".PNG", ".jpeg", ".png", ".tif", ".tiff"]


# ======================================================================
#   LOGGER
# ======================================================================

def get_logger(run_dir: Path) -> logging.Logger:
    """
    Create a logger that writes:
      - detailed logs to run_dir/spikelet_extract.log
      - high-level INFO messages to console
    """
    log_file = run_dir / "spikelet_extract.log"

    logger = logging.getLogger(f"spikelet_extract_{run_dir.name}")
    logger.setLevel(logging.DEBUG)   # capture everything

    # Avoid duplicate handlers if called multiple times
    if logger.handlers:
        return logger

    # File handler (detailed)
    fh = logging.FileHandler(log_file, mode="w")
    fh.setLevel(logging.DEBUG)
    fh_formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s", "%Y-%m-%d %H:%M:%S"
    )
    fh.setFormatter(fh_formatter)

    # Console handler (high-level)
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch_formatter = logging.Formatter("%(message)s")
    ch.setFormatter(ch_formatter)

    logger.addHandler(fh)
    logger.addHandler(ch)

    return logger


# ======================================================================
#   HELPERS
# ======================================================================

def find_image(stem: str, images_dir: Path) -> Path | None:
    for ext in IMAGE_EXTS:
        cand = images_dir / f"{stem}{ext}"
        if cand.exists():
            return cand
    return None


def obb_long_side_length(pts_px):
    return max(
        hypot(pts_px[(i + 1) % 4][0] - pts_px[i][0],
              pts_px[(i + 1) % 4][1] - pts_px[i][1])
        for i in range(4)
    )


def buffer_polygon_px(points_px, buffer_px):
    if len(points_px) != 4:
        return points_px

    p0, p1, p2, p3 = points_px
    cx = sum(p[0] for p in points_px) / 4.0
    cy = sum(p[1] for p in points_px) / 4.0

    ux = p1[0] - p0[0]
    uy = p1[1] - p0[1]
    vx = p3[0] - p0[0]
    vy = p3[1] - p0[1]

    len_u = sqrt(ux * ux + uy * uy)
    len_v = sqrt(vx * vx + vy * vy)

    if len_u < 1e-6 or len_v < 1e-6:
        return points_px

    ux /= len_u
    uy /= len_u
    vx /= len_v
    vy /= len_v

    out = []
    for (x, y) in points_px:
        rx = x - cx
        ry = y - cy
        dot_u = rx * ux + ry * uy
        dot_v = rx * vx + ry * vy

        su = 1 if dot_u >= 0 else -1
        sv = 1 if dot_v >= 0 else -1

        nx = x + su * buffer_px * ux + sv * buffer_px * vx
        ny = y + su * buffer_px * uy + sv * buffer_px * vy
        out.append((nx, ny))

    return out


def clamp_point(x, y, w, h):
    return max(0, min(x, w - 1)), max(0, min(y, h - 1))


def crop_obb_masked_rgb(im: Image.Image, pts_px):
    xs = [p[0] for p in pts_px]
    ys = [p[1] for p in pts_px]
    x1, y1, x2, y2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))

    crop = im.crop((x1, y1, x2, y2))
    local_pts = [(x - x1, y - y1) for (x, y) in pts_px]

    mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(mask).polygon(local_pts, fill=255)

    black = Image.new("RGB", crop.size, (0, 0, 0))
    return Image.composite(crop, black, mask)


# ======================================================================
#   PROCESS ONE LABEL FILE
# ======================================================================

def process_one_label(
    label_path: Path,
    images_dir: Path,
    crops_dir: Path,
    max_crops: int,
    buffer_px: int,
    logger: logging.Logger,
):

    stem = label_path.stem
    img_path = find_image(stem, images_dir)

    if img_path is None:
        logger.warning(f"Missing image for label {label_path.name}")
        return

    im = Image.open(img_path).convert("RGB")
    w, h = im.size

    obb_list = []
    with open(label_path, "r") as f:
        for line in f:
            parts = line.split()
            if len(parts) != 9:
                logger.debug(
                    f"Skipping malformed line in {label_path.name}: {line.strip()}"
                )
                continue

            coords = list(map(float, parts[1:]))
            pts_norm = [(coords[i], coords[i + 1]) for i in range(0, 8, 2)]
            pts_px = [(x * w, y * h) for x, y in pts_norm]

            length = obb_long_side_length(pts_px)
            obb_list.append((pts_px, length))

    if not obb_list:
        logger.info(f"{stem}: no OBBs found, skipping.")
        im.close()
        return

    logger.debug(f"{stem}: found {len(obb_list)} OBBs.")

    # Sort by length
    obb_list.sort(key=lambda x: x[1], reverse=True)
    selected = obb_list[:max_crops]
    logger.info(f"{stem}: selecting top {len(selected)} by length.")

    count = 1
    for pts, length in selected:
        buf_pts = buffer_polygon_px(pts, buffer_px)
        buf_pts = [clamp_point(x, y, w, h) for (x, y) in buf_pts]

        crop = crop_obb_masked_rgb(im, buf_pts)

        rand = random.randint(10000, 99999)
        out_name = f"{stem}_{count:03d}_{rand}.png"
        crop.save(crops_dir / out_name)

        logger.debug(f"{stem}: saved crop {out_name} (length={length:.2f})")
        count += 1

    im.close()


# ======================================================================
#   MAIN FUNCTION THE USER CALLS
# ======================================================================

def run_spike_pipeline(
    yolo_run_name: str,
    model_path: str,                  # <-- REQUIRED NOW
    images_dir: str | Path = "./data/",
    max_crops: int = 30,
    buffer_px: int = 30,
    clear_crops: bool = True,
    results_root: str | Path = "./results/spikeDetect",
):
    """
    User-facing spike extraction pipeline.

    Parameters
    ----------
    yolo_run_name : str
        Subfolder under results_root for this run. Example: "sdsu"
    model_path : str
        Path to YOLO OBB detection model.
    images_dir : str or Path
        Directory containing original RGB images.
    max_crops : int
        Number of longest spikes to crop per image.
    buffer_px : int
        Pixel buffer applied to each OBB polygon.
    clear_crops : bool
        If True, deletes existing crops before generating new ones.
    results_root : str or Path
        Base directory where results (labels & crops) are saved.
    """

    images_dir = Path(images_dir)
    results_root = Path(results_root)

    # Run-specific output structure
    run_dir    = results_root / yolo_run_name
    labels_dir = run_dir / "labels"
    crops_dir  = run_dir / "SpikeletCrops_30px"

    # Create folders
    run_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    crops_dir.mkdir(parents=True, exist_ok=True)

    # Logger
    logger = get_logger(run_dir)
    logger.info("======================================")
    logger.info(f"Spikelet pipeline started for run: {yolo_run_name}")
    logger.info(f"Images dir:  {images_dir}")
    logger.info(f"Results dir: {run_dir}")
    logger.info(f"Model path:  {model_path}")
    logger.info("======================================")

    # Clear previous crops if needed
    if clear_crops:
        for f in crops_dir.glob("*.png"):
            f.unlink()
        logger.info("Cleared existing crops in SpikeletCrops_30px.")

    # ------------------ Stage 1: YOLO detection -----------------------
    logger.info("Stage 1/3: YOLO OBB detection started...")
    model = YOLO(model_path)

    model.predict(
        source=images_dir,
        save=True,
        save_txt=True,
        show_labels=False,
        conf=0.25,
        project=results_root,
        name=yolo_run_name,
        exist_ok=True,
    )
    logger.info("Stage 1/3: YOLO OBB detection completed.")

    # ------------------ Stage 2: Read labels --------------------------
    logger.info("Stage 2/3: Reading label files and selecting top lengths...")
    label_files = sorted(labels_dir.glob("*.txt"))
    logger.info(f"Found {len(label_files)} label files in {labels_dir}")

    if not label_files:
        logger.warning("No label files found. Nothing to crop.")
        return

    # ------------------ Stage 3: Crop top-k spikes --------------------
    logger.info("Stage 3/3: Cropping buffered spikelets...")
    for idx, lbl in enumerate(label_files, start=1):
        logger.info(f"[{idx}/{len(label_files)}] Processing {lbl.name}...")
        process_one_label(
            lbl, images_dir, crops_dir, max_crops, buffer_px, logger
        )

    logger.info("======================================")
    logger.info("Spikelet pipeline completed successfully.")
    logger.info(f"Crops saved to: {crops_dir}")
    logger.info(
        f"Detailed log written to: { (run_dir / 'spikelet_extract.log').resolve() }"
    )
    logger.info("======================================")



if __name__ == "__main__":
    run_spike_pipeline(
        yolo_run_name="sdsu",
        model_path="./models/spikeDetection/best_spike_YOLO11_freeze0_RS2.pt",
        images_dir="./data/",
        max_crops=30,
        buffer_px=30,
        clear_crops=True,
        results_root="./results/spikeDetect",
    )
