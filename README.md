# YOLO OBB Detection (Django + DRF + PostgreSQL + Celery + React Vite)

## Quick Start

```bash
docker compose build
docker compose up
```

- Backend: http://localhost:8000
- Frontend: http://localhost:5173

## Backend-only (decoupled)

Keep the current UI working with the default compose files, but run the backend standalone when you want to develop or deploy it separately:

```bash
# Dev (backend + worker + db + redis)
docker compose -f docker-compose-backend-dev.yml up -d

# Prod (backend + worker + db + redis)
docker compose -f docker-compose-backend-prod.yml up -d
```

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

## Production Checklist
- Copy `backend/.env.production.example` to `backend/.env.production` (or load the variables another way), generate a strong `SECRET_KEY`, and set real database and Redis credentials. For `wheatai.net` set `ALLOWED_HOSTS=wheatai.net,www.wheatai.net` and matching CSRF/CORS origins.
- If you need to hit a production-like backend from localhost for testing, set `INCLUDE_DEV_CORS_ORIGINS=1` in `backend/.env.production` so `http://localhost:*` and `http://127.0.0.1:*` pass CORS.
- Copy `frontend/.env.production.example` to `frontend/.env.production`, keep `VITE_API_BASE=https://wheatai.net`, and adjust `VITE_API_TIMEOUT_MS` if detections run longer than 3 minutes.
- Build the static bundle via Docker: `docker compose -f docker-compose-prod.yml --profile build run --rm frontend-build`. The generated files land in `frontend/dist/` and are served by the Nginx container.
- Obtain a publicly trusted TLS certificate before enabling the HTTPS stack:  
  `docker compose -f docker-compose-prod.yml up -d nginx` (serves with a self-signed cert) →  
  `docker compose -f docker-compose-prod.yml --profile certbot run --rm certbot` (issues Let’s Encrypt cert via webroot) →  
  `docker compose -f docker-compose-prod.yml restart nginx` (reloads the real cert). Subsequent renewals can reuse the same command.
- Until the Let’s Encrypt certificate is in place the site will present the bundled self-signed certificate, so expect browsers to flag it as insecure during the first step above.
- The production compose file runs Gunicorn behind Nginx; the Django port is only exposed internally so always call the API through `https://wheatai.net/api/...`.
- Request timeouts are tuned for long detections (Nginx 300 s, frontend 180 s, Gunicorn `${GUNICORN_TIMEOUT:-300}`); raise these if your workloads need more time.
- Redis/Postgres stay on the internal network. If you expose them elsewhere, add authentication and restrict access.
- `RUN_MIGRATIONS=1` and `COLLECTSTATIC=1` are enabled by default; override them if you need a safer rollout strategy.

## Local dev environment files
- Backend: copy `backend/.env.development.example` to `backend/.env` (or `.env.development`) when running Django locally. It enables DEBUG, localhost CORS/CSRF, and points DB/Redis to `127.0.0.1`.
- Frontend: copy `frontend/.env.development.example` to `frontend/.env` for Vite dev server. It targets `http://localhost:8000` by default; bump `VITE_API_PORT` if your backend runs on a different port.
- Docker dev (`docker-compose-dev.yml`) already injects permissive CORS/DEBUG and binds the backend on port 8000 and frontend on 5173, so you typically don’t need extra env tweaking when using Compose.

Enjoy!
