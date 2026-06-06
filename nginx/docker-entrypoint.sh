#!/bin/sh
set -e

DOMAIN=${TLS_DOMAIN:-wheatai.net}
CHECK_INTERVAL_SECONDS=${TLS_RELOAD_CHECK_INTERVAL_SECONDS:-60}

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
LE_FULLCHAIN="${CERT_DIR}/fullchain.pem"
LE_PRIVKEY="${CERT_DIR}/privkey.pem"

cert_fingerprint() {
  if [ -s "$LE_FULLCHAIN" ] && [ -s "$LE_PRIVKEY" ]; then
    sha256sum "$LE_FULLCHAIN" "$LE_PRIVKEY" | sha256sum | awk '{print $1}'
  else
    echo "missing"
  fi
}

watch_certificates() {
  last_fingerprint=$(cert_fingerprint)

  while true; do
    sleep "$CHECK_INTERVAL_SECONDS"
    current_fingerprint=$(cert_fingerprint)

    if [ "$current_fingerprint" != "$last_fingerprint" ]; then
      if [ "$current_fingerprint" = "missing" ]; then
        echo "Let's Encrypt certificate for ${DOMAIN} is missing; skipping nginx reload."
      else
        echo "Detected updated Let's Encrypt certificate for ${DOMAIN}; reloading nginx."
        nginx -s reload
      fi
      last_fingerprint="$current_fingerprint"
    fi
  done
}

# Only log status; NEVER write self-signed certs into /etc/letsencrypt
if [ -s "$LE_FULLCHAIN" ] && [ -s "$LE_PRIVKEY" ]; then
  echo "Using Let's Encrypt certificate for ${DOMAIN}"
else
  echo "Let's Encrypt certificate for ${DOMAIN} not found yet. HTTPS may fail until certbot issues it."
  echo "Expected: $LE_FULLCHAIN and $LE_PRIVKEY"
fi

(watch_certificates) &

exec nginx -g "daemon off;"
