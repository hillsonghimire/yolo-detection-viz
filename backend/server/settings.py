import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=None):
    raw = os.environ.get(name)
    if raw:
        return [item.strip() for item in raw.split(",") if item.strip()]
    if default is None:
        return []
    if isinstance(default, (list, tuple, set)):
        return [str(item).strip() for item in default if str(item).strip()]
    return [item.strip() for item in str(default).split(",") if item.strip()]


def env_int(name, default=0):
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def dedupe(seq):
    seen = set()
    out = []
    for item in seq:
        if item and item not in seen:
            out.append(item)
            seen.add(item)
    return out


SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key")
DEBUG = env_bool("DEBUG", True)
_allowed_hosts = env_list("ALLOWED_HOSTS", ["*"])
ALLOWED_HOSTS = _allowed_hosts or ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django_celery_results",
    "rest_framework",
    'drf_spectacular',
    "corsheaders",
    "detections",
]

REST_FRAMEWORK = {
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "server.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "server.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "yoloapp"),
        "USER": os.environ.get("DB_USER", "yolo"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "yolo_pass"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", str(BASE_DIR.parent / "media")))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS / CSRF
CSRF_TRUSTED_ORIGINS = [origin.rstrip("/") for origin in env_list("CSRF_TRUSTED_ORIGINS")]
_explicit_cors = env_list("CORS_ALLOWED_ORIGINS")
_dev_cors = [
    "http://localhost",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
]
if env_bool("INCLUDE_DEV_CORS_ORIGINS", DEBUG):
    _explicit_cors.extend(_dev_cors)
CORS_ALLOWED_ORIGINS = dedupe(origin.rstrip("/") for origin in _explicit_cors)
_default_allow_all = not env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL", _default_allow_all)

# HTTPS hardening (tunable via environment)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 0 if DEBUG else 3600)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
SECURE_REFERRER_POLICY = os.environ.get("SECURE_REFERRER_POLICY", "same-origin")

# Celery
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = env_bool(
    "CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP", True
)
