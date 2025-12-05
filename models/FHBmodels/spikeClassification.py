from pathlib import Path
import shutil
import logging
from concurrent.futures import ThreadPoolExecutor

# Adjust this import to match your folder structure exactly:
# models/orientationClassification/SpikeClassifier.py
from FHBmodels.orientationClassification.spikeClassifier import SpikeClassifier


# ======================================================================
#   LOGGER
# ======================================================================

def get_logger(run_dir: Path) -> logging.Logger:
    """
    Create a logger that writes:
      - detailed logs to run_dir/spike_classification.log
      - high-level INFO messages to console.
    """
    log_file = run_dir / "spike_classification.log"

    logger = logging.getLogger(f"spike_classification_{run_dir.name}")
    logger.setLevel(logging.DEBUG)

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
#   MAIN CLASSIFICATION / MOVE FUNCTION
# ======================================================================

def move_good_oriented_spikes(
    run_name: str,
    model_path: str,
    results_root: str | Path = "./results/spikeDetect",
    input_subdir: str = "SpikeletCrops_30px",
    output_subdir: str = "SpikeletCrops_30px_good",
    num_workers: int = 1,
):
    """
    Classify spike crops from a YOLO+crop run and move only
    'Good Orientation' spikes into a separate subfolder inside
    the SAME run directory.

    Directory structure (example)
    -----------------------------
    results_root/
        run_name/
            labels/
            SpikeletCrops_30px/          # input_subdir  (YOLO crops)
            SpikeletCrops_30px_good/     # output_subdir (GOOD orientation)
            spikelet_extract.log
            spike_classification.log

    Parameters
    ----------
    run_name : str
        Name of YOLO/cropping run that produced input_subdir
        (e.g., 'sdsu_20251127_153012').
    model_path : str
        Path to the trained orientation classifier (.pth) used by SpikeClassifier.
    results_root : str or Path
        Root directory where all spikeDetect results live.
    input_subdir : str
        Subfolder under run_name with spike crops (default 'SpikeletCrops_30px').
    output_subdir : str
        Subfolder under run_name where good-oriented spikes are moved
        (default 'SpikeletCrops_30px_good').
    num_workers : int
        Number of threads to use for classification. >1 enables parallel
        predictions to speed up large batches.
    """

    results_root = Path(results_root)

    run_dir    = results_root / run_name
    source_dir = run_dir / input_subdir
    good_dir   = run_dir / output_subdir

    run_dir.mkdir(parents=True, exist_ok=True)
    good_dir.mkdir(parents=True, exist_ok=True)

    logger = get_logger(run_dir)

    if not source_dir.exists():
        logger.error(f"Source spike crops folder does not exist: {source_dir}")
        return

    logger.info("======================================")
    logger.info("Good-orientation spike classification started")
    logger.info(f"Run directory: {run_dir}")
    logger.info(f"Source crops:  {source_dir}")
    logger.info(f"Good spikes →  {good_dir}")
    logger.info(f"Classifier model: {model_path}")
    logger.info(f"Workers: {max(1, num_workers)}")
    logger.info("======================================")

    # Init classifier
    classifier = SpikeClassifier(model_path)

    png_files = sorted(source_dir.glob("*.png"))
    logger.info(f"Found {len(png_files)} spike crops in {source_dir}")

    moved = 0
    skipped = 0
    worker_count = max(1, num_workers)

    def classify(img_path: Path):
        try:
            with img_path.open("rb") as f:
                img_bytes = f.read()
            return classifier.predict(img_bytes)
        except Exception as e:
            return {"error": str(e)}

    if worker_count == 1:
        results = [(img_path, classify(img_path)) for img_path in png_files]
    else:
        with ThreadPoolExecutor(max_workers=min(worker_count, len(png_files))) as ex:
            mapped = ex.map(classify, png_files)
            results = list(zip(png_files, mapped))

    for idx, (img_path, result) in enumerate(results, start=1):
        if "error" in result:
            logger.warning(
                f"[{idx}/{len(png_files)}] {img_path.name} → ERROR: {result['error']}"
            )
            skipped += 1
            continue

        label = result.get("label", "")
        conf  = result.get("confidence", 0.0)

        if label == "Good Orientation":
            dest = good_dir / img_path.name
            # MOVE (not copy) so good spikes are removed from input_subdir
            shutil.move(str(img_path), str(dest))
            moved += 1
            logger.info(
                f"[{idx}/{len(png_files)}] {img_path.name} → GOOD ({conf:.2f}%)"
            )
        else:
            skipped += 1
            logger.debug(
                f"[{idx}/{len(png_files)}] {img_path.name} skipped as BAD ({conf:.2f}%)"
            )

    logger.info("======================================")
    logger.info("Good-orientation spike classification completed")
    logger.info(f"Moved Lateral (GOOD) spikes:    {moved}")
    logger.info(f"Ignored / Frontal (BAD) spikes: {skipped}")
    logger.info(f"Good spikes folder:   {good_dir}")
    logger.info(
        f"Log written to:       {(run_dir / 'spike_classification.log').resolve()}"
    )
    logger.info("======================================")
