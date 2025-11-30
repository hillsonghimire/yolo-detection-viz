import os
import psycopg2
import sys

print("Testing DB connection...", flush=True)
try:
    conn = psycopg2.connect(
        host=os.environ.get('DB_HOST', 'db'),
        port=os.environ.get('DB_PORT', '5432'),
        user=os.environ.get('DB_USER', 'yolo'),
        password=os.environ.get('DB_PASSWORD', 'yolo_pass'),
        dbname=os.environ.get('DB_NAME', 'yoloapp'),
        connect_timeout=5
    )
    cur = conn.cursor()
    cur.execute('SELECT 1')
    print(f"DB Success: {cur.fetchone()}", flush=True)
    conn.close()
except Exception as e:
    print(f"DB Error: {e}", flush=True)
    sys.exit(1)
