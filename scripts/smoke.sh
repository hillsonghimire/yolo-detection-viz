#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000/api}"
SAMPLES_DIR="${SAMPLES_DIR:-frontend/public/samples}"
POLL_TRIES="${POLL_TRIES:-30}"
POLL_SLEEP="${POLL_SLEEP:-2}"
CURL_INSECURE="${CURL_INSECURE:-0}"
CURL_HOST="${CURL_HOST:-}"
CURL_FORWARDED_PROTO="${CURL_FORWARDED_PROTO:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

pick_python() {
  if command -v python >/dev/null 2>&1; then
    echo "python"
  elif command -v python3 >/dev/null 2>&1; then
    echo "python3"
  else
    echo ""
  fi
}

json_get() {
  local path="$1"
  "$PYTHON_BIN" -c 'import json,sys
path=sys.argv[1]
data=json.load(sys.stdin)
cur=data
for key in path.split("."):
    if not key:
        continue
    if isinstance(cur, dict) and key in cur:
        cur=cur[key]
    else:
        cur=None
        break
if cur is None:
    sys.exit(1)
print(json.dumps(cur) if isinstance(cur,(dict,list)) else cur)
' "$path"
}

bulk_excel_for_id() {
  local bulk_id="$1"
  "$PYTHON_BIN" -c 'import json,sys
bulk_id=sys.argv[1]
data=json.load(sys.stdin)
excel=None
for item in data:
    if str(item.get("id"))==bulk_id:
        excel=item.get("excel_file")
        break
if excel:
    print(excel)
' "$bulk_id"
}

pick_image() {
  local dir="$1"
  ls "$dir" 2>/dev/null | head -n 1
}

post_basic() {
  local folder="$1"
  local model="$2"
  local img
  img="$(pick_image "$SAMPLES_DIR/$folder")"
  if [[ -z "$img" ]]; then
    echo "SKIP basic/$model: no images in $SAMPLES_DIR/$folder"
    return
  fi
  local path="$SAMPLES_DIR/$folder/$img"
  local code
  code="$("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" \
    -F "model=$model" \
    -F "image=@$path" \
    "$API_BASE/detect/basic/")"
  echo "basic/$model -> $code"
}

post_large() {
  local folder="$1"
  local model="$2"
  local img
  img="$(pick_image "$SAMPLES_DIR/$folder")"
  if [[ -z "$img" ]]; then
    echo "SKIP large/$model: no images in $SAMPLES_DIR/$folder" >&2
    return
  fi
  local path="$SAMPLES_DIR/$folder/$img"
  local resp
  resp="$("${CURL_BASE[@]}" \
    -F "model=$model" \
    -F "image=@$path" \
    "$API_BASE/detect/large/")"
  local job_id
  job_id="$(echo "$resp" | json_get "unique_id" 2>/dev/null || true)"
  if [[ -n "$job_id" ]]; then
    echo "large/$model -> $job_id" >&2
  else
    echo "large/$model -> unable to read job id" >&2
  fi
  echo -n "$job_id"
}

post_bulk() {
  local folder="$1"
  local model="$2"
  local img1 img2
  img1="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 1)"
  img2="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 2 | tail -n 1)"
  if [[ -z "$img1" || -z "$img2" ]]; then
    echo "SKIP bulk/$model: need at least 2 images in $SAMPLES_DIR/$folder" >&2
    return
  fi
  local code
  code="$("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" \
    -F "model=$model" \
    -F "images=@$SAMPLES_DIR/$folder/$img1" \
    -F "images=@$SAMPLES_DIR/$folder/$img2" \
    "$API_BASE/detect/bulk/")"
  echo "bulk/$model -> $code"
}

post_bulk_with_id() {
  local folder="$1"
  local model="$2"
  local img1 img2
  img1="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 1)"
  img2="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 2 | tail -n 1)"
  if [[ -z "$img1" || -z "$img2" ]]; then
    echo "SKIP bulk/$model: need at least 2 images in $SAMPLES_DIR/$folder"
    return
  fi
  local resp
  resp="$("${CURL_BASE[@]}" \
    -F "model=$model" \
    -F "images=@$SAMPLES_DIR/$folder/$img1" \
    -F "images=@$SAMPLES_DIR/$folder/$img2" \
    "$API_BASE/detect/bulk/")"
  local bulk_id
  bulk_id="$(echo "$resp" | json_get "bulk_job_id" 2>/dev/null || true)"
  if [[ -n "$bulk_id" ]]; then
    echo "bulk/$model -> $bulk_id" >&2
  else
    echo "bulk/$model -> unable to read bulk job id" >&2
  fi
  echo -n "$bulk_id"
}

post_bulk_kernel() {
  local folder="kernel"
  local img1 img2
  img1="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 1)"
  img2="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 2 | tail -n 1)"
  if [[ -z "$img1" || -z "$img2" ]]; then
    echo "SKIP bulk/kernel: need at least 2 images in $SAMPLES_DIR/$folder"
    return
  fi
  local code
  code="$("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" \
    -F "model=kernel" \
    -F "sidemm=40" \
    -F "allowed_ids=425,100,201,310" \
    -F "images=@$SAMPLES_DIR/$folder/$img1" \
    -F "images=@$SAMPLES_DIR/$folder/$img2" \
    "$API_BASE/detect/bulk/")"
  echo "bulk/kernel -> $code"
}

post_kernel_measure() {
  local folder="kernel"
  local img
  img="$(pick_image "$SAMPLES_DIR/$folder")"
  if [[ -z "$img" ]]; then
    echo "SKIP measure/kernel: no images in $SAMPLES_DIR/$folder" >&2
    return
  fi
  local resp
  resp="$("${CURL_BASE[@]}" \
    -F "image=@$SAMPLES_DIR/$folder/$img" \
    -F "sidemm=40" \
    -F "allowed_ids=425,100,201,310" \
    "$API_BASE/measure/kernel/")"
  local job_id
  job_id="$(echo "$resp" | json_get "unique_id" 2>/dev/null || true)"
  if [[ -n "$job_id" ]]; then
    echo "measure/kernel -> $job_id" >&2
  else
    echo "measure/kernel -> unable to read job id" >&2
  fi
  echo -n "$job_id"
}

post_fhb_field() {
  local folder="fhb-field"
  local img1 img2
  img1="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 1)"
  img2="$(ls "$SAMPLES_DIR/$folder" 2>/dev/null | head -n 2 | tail -n 1)"
  if [[ -z "$img1" || -z "$img2" ]]; then
    echo "SKIP pipeline/fhb-field: need at least 2 images in $SAMPLES_DIR/$folder" >&2
    return
  fi
  local resp
  resp="$("${CURL_BASE[@]}" \
    -F "images=@$SAMPLES_DIR/$folder/$img1" \
    -F "images=@$SAMPLES_DIR/$folder/$img2" \
    "$API_BASE/pipeline/fhb-field/")"
  local excel_rel
  excel_rel="$(echo "$resp" | json_get "excel_rel_path" 2>/dev/null || true)"
  if [[ -n "$excel_rel" ]]; then
    echo "pipeline/fhb-field -> excel ${excel_rel}" >&2
    echo -n "$excel_rel"
  else
    echo "pipeline/fhb-field -> ok" >&2
  fi
}

poll_job() {
  local job_id="$1"
  local i
  for ((i = 1; i <= POLL_TRIES; i++)); do
    local resp status
    resp="$("${CURL_BASE[@]}" "$API_BASE/jobs/$job_id/")"
    status="$(echo "$resp" | json_get "status" 2>/dev/null || true)"
    if [[ "$status" == "DONE" || "$status" == "FAILED" ]]; then
      echo "$resp"
      return
    fi
    sleep "$POLL_SLEEP"
  done
  echo "$resp"
}

require_cmd curl
PYTHON_BIN="$(pick_python)"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Missing required command: python or python3" >&2
  exit 1
fi

CURL_BASE=(curl -sS)
if [[ "$CURL_INSECURE" == "1" ]]; then
  CURL_BASE+=(-k)
fi
if [[ -n "$CURL_HOST" ]]; then
  CURL_BASE+=(-H "Host: $CURL_HOST")
fi
if [[ -n "$CURL_FORWARDED_PROTO" ]]; then
  CURL_BASE+=(-H "X-Forwarded-Proto: $CURL_FORWARDED_PROTO")
fi

echo "API: $API_BASE"
echo "Samples: $SAMPLES_DIR"

echo "health -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/health/")"

post_basic "spike" "spike"
post_basic "spikelet" "spikelet"
post_basic "fhb" "fhb"
post_basic "fdk" "fdk"
post_basic "kernel" "kernel"
post_basic "uav-spike" "uav_spike"

large_job_id="$(post_large "spike" "spike")"
bulk_job_id="$(post_bulk_with_id "spike" "spike")"
post_bulk_kernel
kernel_job_id="$(post_kernel_measure)"
fhb_excel_rel="$(post_fhb_field || true)"

echo "bulk_jobs -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/bulk_jobs/")"
echo "jobs -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/jobs/")"

if [[ -n "${large_job_id:-}" ]]; then
  job_resp="$(poll_job "$large_job_id")"
  labels_file="$(echo "$job_resp" | json_get "labels_file" 2>/dev/null || true)"
  annotated_file="$(echo "$job_resp" | json_get "annotated_image" 2>/dev/null || true)"
  if [[ -n "$labels_file" ]]; then
    labels_name="$(basename "$labels_file")"
    echo "download/labels -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/download/$labels_name")"
  fi
  if [[ -n "$annotated_file" ]]; then
    annotated_name="$(basename "$annotated_file")"
    echo "download/image -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/download/image/$annotated_name")"
  fi
fi

if [[ -n "${kernel_job_id:-}" ]]; then
  kernel_resp="$(poll_job "$kernel_job_id")"
  csv_rel="$(echo "$kernel_resp" | json_get "result.measurement_csv" 2>/dev/null || true)"
  overlay_rel="$(echo "$kernel_resp" | json_get "result.measurement_overlay" 2>/dev/null || true)"
  if [[ -n "$csv_rel" ]]; then
    csv_name="$(basename "$csv_rel")"
    echo "download/measure/csv -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/download/measure/csv/$csv_name")"
  fi
  if [[ -n "$overlay_rel" ]]; then
    overlay_name="$(basename "$overlay_rel")"
    echo "download/measure/image -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/download/measure/image/$overlay_name")"
  fi
fi

if [[ -n "${bulk_job_id:-}" ]]; then
  bulk_list="$("${CURL_BASE[@]}" "$API_BASE/bulk_jobs/")"
  excel_file="$(echo "$bulk_list" | bulk_excel_for_id "$bulk_job_id" 2>/dev/null || true)"
  if [[ -n "$excel_file" ]]; then
    excel_name="$(basename "$excel_file")"
    echo "download/excel -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/download/excel/$excel_name")"
  fi
fi

if [[ -n "${fhb_excel_rel:-}" ]]; then
  fhb_name="$(basename "$fhb_excel_rel")"
  echo "download/media (fhb excel) -> $("${CURL_BASE[@]}" -o /dev/null -w "%{http_code}" "$API_BASE/download/media/$fhb_excel_rel")"
fi
