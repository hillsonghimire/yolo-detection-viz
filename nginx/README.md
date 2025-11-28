# SSL certificates

The repository does not ship private keys. For local development you can generate a self-signed certificate into `nginx/selfsigned` (ignored by git):

```bash
mkdir -p nginx/selfsigned
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/selfsigned/default.key \
  -out nginx/selfsigned/default.crt \
  -subj "/CN=localhost"
```

Use real certificates for any public deployment (e.g., via Let’s Encrypt volumes mounted at `nginx/certs`).***
