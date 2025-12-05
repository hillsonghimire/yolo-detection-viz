from pathlib import Path
import logging

import pandas as pd
from ultralytics import YOLO


# ======================================================================
#   LOGGER
# ======================================================================

def get_logger(run_dir: Path) -> logging.Logger:
    """
    Create a logger that writes:
      - detailed logs to run_dir/fhb_detection.log
      - high-level INFO messages to console
    """
    log_file = run_dir / "fhb_detection.log"

    logger = logging.getLogger(f"fhb_detection_{run_dir.name}")
    logger.setLevel(logging.DEBUG)

    # Avoid duplicate handlers
    if logger.handlers:
        return logger

    # File handler
    fh = logging.FileHandler(log_file, mode="w")
    fh.setLevel(logging.DEBUG)
    fh_formatter = logging.Formatter(
        "%(asctime)s - %(levelname)s - %(message)s", "%Y-%m-%d %H:%M:%S"
    )
    fh.setFormatter(fh_formatter)

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(message)s"))

    logger.addHandler(fh)
    logger.addHandler(ch)

    return logger


# ======================================================================
#   HELPERS
# ======================================================================

def original_image_name_from_crop(crop_stem: str) -> str:
    """
    Extract original image name from crop name:
        stem_003_54321 → stem
    """
    parts = crop_stem.split("_")
    return "_".join(parts[:-2]) if len(parts) >= 3 else crop_stem


# ======================================================================
#   MAIN FHB DETECTION FUNCTION
# ======================================================================

def fhb_detect(
    run_name: str,
    results_root: str | Path = "./results/spikeDetect",
    good_spikes_subdir: str = "SpikeletCrops_30px_good",
    fhb_model_path: str = "./models/FHBDetection/best_FHB_randomWt_RS2-Aug2.pt",
    infected_classes: set[int] | None = None,
    non_infected_classes: set[int] | None = None,
    imgsz: int = 600,
    conf: float = 0.25,
    save_overlays: bool = False,               # <-- NEW PARAMETER
    output_excel_name: str = "FHB_summary_per_image.xlsx",
):
    """
    Run FHB YOLO on good-oriented spike crops and aggregate per original image.

    Parameters
    ----------
    save_overlays : bool
        If True: YOLO saves output images with bounding boxes.
        If False: Only saves label .txt files (faster, uses less storage).
    """

    # Default class maps
    if infected_classes is None:
        infected_classes = {0}
    if non_infected_classes is None:
        non_infected_classes = {1}

    results_root = Path(results_root)
    run_dir = results_root / run_name
    good_spikes_dir = run_dir / good_spikes_subdir

    fhb_results_root = good_spikes_dir / "FHB_labels"
    fhb_results_root.mkdir(parents=True, exist_ok=True)

    fhb_labels_dir = fhb_results_root / "pred" / "labels"

    logger = get_logger(run_dir)

    if not good_spikes_dir.exists():
        logger.error(f"Good spike directory not found: {good_spikes_dir}")
        return None, None

    # Check good spike count
    crop_files = sorted(good_spikes_dir.glob("*.png"))
    if len(crop_files) == 0:
        logger.warning(f"No PNG files found in {good_spikes_dir}")
        return None, None

    # ----------------------------------------------------------
    # 1) YOLO FHB DETECTION
    # ----------------------------------------------------------
    logger.info("======================================")
    logger.info("FHB detection started")
    logger.info(f"Run directory:             {run_dir}")
    logger.info(f"Good spike crops:          {good_spikes_dir}")
    logger.info(f"FHB model:                 {fhb_model_path}")
    logger.info(f"Save overlays:             {save_overlays}")
    logger.info(f"FHB labels will be in:     {fhb_results_root}")
    logger.info("======================================")

    logger.info("Loading FHB YOLO model...")
    fhb_model = YOLO(fhb_model_path)

    logger.info("Running FHB YOLO prediction...")
    fhb_model.predict(
        source=good_spikes_dir,
        imgsz=imgsz,
        conf=conf,
        agnostic_nms=True,
        save=save_overlays,          # <-- NEW OPTION
        save_txt=True,
        show_labels=False,
        project=fhb_results_root,
        name="pred",
        exist_ok=True,
    )

    logger.info("FHB prediction completed.")

    # ----------------------------------------------------------
    # 2) AGGREGATE RESULTS PER ORIGINAL IMAGE
    # ----------------------------------------------------------
    logger.info("Aggregating per-image FHB statistics...")

    agg = {}

    for crop_path in crop_files:
        crop_stem = crop_path.stem
        big_name = original_image_name_from_crop(crop_stem)

        if big_name not in agg:
            agg[big_name] = {
                "image_name": big_name,
                "num_spikes": 0,
                "fhb_infected_spikelets": 0,
                "fhb_noninfected_spikelets": 0,
            }

        agg[big_name]["num_spikes"] += 1

        label_path = fhb_labels_dir / f"{crop_stem}.txt"
        if not label_path.exists():
            continue

        # Parse label file
        with open(label_path, "r") as f:
            for line in f:
                parts = line.strip().split()
                if not parts:
                    continue
                cls_id = int(parts[0])

                if cls_id in infected_classes:
                    agg[big_name]["fhb_infected_spikelets"] += 1
                elif cls_id in non_infected_classes:
                    agg[big_name]["fhb_noninfected_spikelets"] += 1

    rows = list(agg.values())
    rows.sort(key=lambda r: r["image_name"])

    if not rows:
        logger.warning("Aggregation produced zero rows.")
        return None, None

    df = pd.DataFrame(rows)
    excel_path = run_dir / output_excel_name
    df.to_excel(excel_path, index=False)

    logger.info("======================================")
    logger.info("FHB detection + aggregation completed.")
    logger.info(f"Images processed:  {len(rows)}")
    logger.info(f"Excel saved at:    {excel_path.resolve()}")
    logger.info("======================================")

    return df, excel_path


# ======================================================================
#   CLI TEST
# ======================================================================

if __name__ == "__main__":
    fhb_detect(
        run_name="test_run",
        results_root="./results/spikeDetect",
        good_spikes_subdir="SpikeletCrops_30px_good",
        fhb_model_path="./models/FHBDetection/best_FHB_randomWt_RS2-Aug2.pt",
        infected_classes={0},
        non_infected_classes={1},
        imgsz=600,
        conf=0.25,
        save_overlays=True,     # TRY overlays ON
        output_excel_name="FHB_summary.xlsx",
    )
