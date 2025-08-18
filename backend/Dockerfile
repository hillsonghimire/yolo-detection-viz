# ---- Base Python image -------------------------------------------------------
FROM python:3.11-slim

# ---- Environment -------------------------------------------------------------
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# ---- System packages (OpenCV + Postgres + build tools) -----------------------
# - libgl1, libglib2.0-0, libsm6, libxrender1, libxext6: OpenCV runtime deps
# - ffmpeg: Ultralytics/video I/O
# - netcat-openbsd & postgresql-client: for entrypoint wait (pg_isready/nc)
# - build-essential libpq-dev: compile psycopg2 if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc libpq-dev curl \
    libgl1 libglib2.0-0 libsm6 libxrender1 libxext6 \
    ffmpeg \
    netcat-openbsd postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# ---- Workdir -----------------------------------------------------------------
WORKDIR /app

# ---- Python deps -------------------------------------------------------------
# Copy only requirements first for better Docker layer caching
COPY requirements.txt /app/requirements.txt

# Install PyTorch CPU wheels first (adjust versions if your project pins them)
# If you later need CUDA, change the index-url to the CUDA build you want.
RUN pip install --no-cache-dir \
    torch==2.3.1 torchvision==0.18.1 --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies
RUN pip install --no-cache-dir -r /app/requirements.txt

# ---- Project files -----------------------------------------------------------
# Copy the rest of your backend project (Django app, manage.py, etc.)
COPY . /app/

# Normalize Windows line endings on the entrypoint and make it executable.
# (This prevents "exec format error" and "^M" issues on Windows hosts.)
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# ---- Network -----------------------------------------------------------------
EXPOSE 8000

# Note:
# - We intentionally do NOT set ENTRYPOINT/CMD here because docker-compose.yml
#   already provides:
#     entrypoint: ["/app/entrypoint.sh"]
#     command: ["python","manage.py","runserver","0.0.0.0:8000"]
# - The same image can be reused for the Celery worker service with its own command.
