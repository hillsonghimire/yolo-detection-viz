# YOLO OBB Detection (Django + DRF + PostgreSQL + Celery + React Vite)

## Quick Start

```bash
docker compose build
docker compose up
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173

Upload an image and click **Start Processing**. After detection finishes, a **Confidence** slider appears. Change it and click **Re-run with confidence** to run again.

## Environment

- PostgreSQL 15 (db:5432, db=user `yolo`, pass `yolo_pass`, database `yoloapp`)
- Redis 7
- Django 5 + DRF
- Celery 5 with Redis broker
- Ultralytics YOLO (supports `DETECTION_TASK=obb` or standard detect)

### Model Weights
Place your model file in the `./models/` directory. The backend reads `MODEL_PATH` env (default `/app/models/obb_best.pt`).

### Media
Uploaded images stored under `backend/media/uploads` (mounted to a volume).

## API
- `POST /api/detect/basic/` fields: `image` (file), `confidence` (float). Returns list of boxes.
- `POST /api/detect/large/` enqueues Celery job (demo).

## Common Issues
- If you change models, rebuild backend and worker: `docker compose build backend worker && docker compose up -d`.
- If DB schema gets stuck, remove volumes: `docker compose down -v` (this wipes data).

Enjoy!
