import os
from typing import Dict, List, Tuple

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from detections.inference import run_detection


class Command(BaseCommand):
    help = "Warm the detection cache by running inference on sample images."

    def add_arguments(self, parser):
        parser.add_argument(
            "--root",
            default=os.path.join(settings.BASE_DIR, "frontend", "public", "samples"),
            help="Root directory that contains sample subfolders (spike, spikelet, fhb, fdk, kernel, uav_spike).",
        )
        parser.add_argument(
            "--conf",
            type=float,
            default=0.05,
            help="Confidence threshold used when warming the cache (matches basic detect default).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Optional limit per model; 0 means process all files in that model's folder.",
        )

    def handle(self, *args, **options):
        root = options["root"]
        conf = float(options["conf"])
        limit = int(options["limit"] or 0)

        if not os.path.isdir(root):
            raise CommandError(f"Sample root not found: {root}")

        # Map folder names to model keys accepted by the API.
        valid_models = {"spike", "spikelet", "fhb", "fdk", "kernel", "uav_spike"}
        worklist: List[Tuple[str, str]] = []

        for entry in sorted(os.listdir(root)):
            model_name = entry.strip().lower().replace("-", "_")
            if model_name not in valid_models:
                continue

            folder = os.path.join(root, entry)
            if not os.path.isdir(folder):
                continue

            imgs = [
                os.path.join(folder, f)
                for f in sorted(os.listdir(folder))
                if os.path.isfile(os.path.join(folder, f))
                and f.lower().rsplit(".", 1)[-1] in {"jpg", "jpeg", "png"}
            ]

            if limit > 0:
                imgs = imgs[:limit]

            for path in imgs:
                worklist.append((model_name, path))

        if not worklist:
            self.stdout.write(self.style.WARNING("No sample images found to warm the cache."))
            return

        self.stdout.write(f"Found {len(worklist)} sample images across models; warming cache...")

        warmed = 0
        failures = 0
        for idx, (model_name, img_path) in enumerate(worklist, start=1):
            try:
                self.stdout.write(f"[{idx}/{len(worklist)}] {model_name}: {os.path.basename(img_path)}")
                run_detection(
                    image_path=img_path,
                    confidence=conf,
                    model_name=model_name,
                    use_cache=True,
                )
                warmed += 1
            except FileNotFoundError as e:
                failures += 1
                self.stderr.write(self.style.ERROR(f"Missing model or image: {e}"))
            except Exception as e:
                failures += 1
                self.stderr.write(self.style.ERROR(f"Error warming {img_path}: {e}"))

        summary = f"Warmed {warmed} file(s); failures: {failures}."
        if failures:
            self.stdout.write(self.style.WARNING(summary))
        else:
            self.stdout.write(self.style.SUCCESS(summary))
