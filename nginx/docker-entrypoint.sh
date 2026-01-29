#!/bin/sh
set -e

DOMAIN=${TLS_DOMAIN:-wheatai.net}
ALT_DOMAIN=${TLS_ALT_DOMAIN:-www.${DOMAIN}}

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
FALLBACK_CERT="/etc/selfsigned/default.crt"
FALLBACK_KEY="/etc/selfsigned/default.key"

if [ ! -f "${CERT_DIR}/fullchain.pem" ] || [ ! -f "${CERT_DIR}/privkey.pem" ]; then
  echo "No Let’s Encrypt certificate found for ${DOMAIN}. Using bundled self-signed certificate until one is issued."
  mkdir -p "${CERT_DIR}"
  cp "${FALLBACK_CERT}" "${CERT_DIR}/fullchain.pem"
  cp "${FALLBACK_CERT}" "${CERT_DIR}/cert.pem"
  cp "${FALLBACK_CERT}" "${CERT_DIR}/chain.pem"
  cp "${FALLBACK_KEY}" "${CERT_DIR}/privkey.pem"
fi

exec nginx -g "daemon off;"
