// One-time detection call. Slider filtering is client-side.
// Resolve API base robustly:
// 1) Prefer explicit VITE_API_BASE
// 2) Otherwise, assume backend is on same host at port 8000
//    (works when accessing from another device and avoids hardcoded localhost)
// 3) Fallback to localhost:8000
const resolvedBase = (() => {
  const normalize = (urlStr) => {
    try {
      const u = new URL(urlStr);
      const host = (u.hostname === 'localhost') ? '127.0.0.1' : u.hostname;
      const port = u.port || '8000';
      return `${u.protocol}//${host}:${port}`.replace(/\/$/, "");
    } catch {
      return urlStr.replace(/\/$/, "");
    }
  };

  const envBase = import.meta.env?.VITE_API_BASE?.trim();
  if (envBase) return normalize(envBase);
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    const host = hostname === 'localhost' ? '127.0.0.1' : hostname;
    return `${protocol}//${host}:8000`;
  }
  return "http://127.0.0.1:8000";
})();
const BASE = resolvedBase;

export async function detectOnce({ file, model, minConf = 0.05 }){
  const fd = new FormData();
  fd.append("image", file);     // Django view expects 'image' (or handle both)
  fd.append("model", model);    // spike | spikelet | fdk | fhb
  fd.append("conf", String(minConf));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(`${BASE}/api/detect/basic/`, {
      method: "POST",
      body: fd,
      headers: { "Accept": "application/json" },
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error("Request timed out after 20s");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  if(!res.ok){
    const msg = await res.text().catch(()=>"" );
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return res.json();
}

// ---- Bulk processing APIs ----
export async function submitBulk({ files, model, confidence = 0.25 }) {
  const fd = new FormData();
  const valid = [];
  for (const f of files || []) {
    if (f && typeof f.size === 'number' && f.size > 0 && (!f.type || f.type.startsWith('image/'))) {
      valid.push(f);
      fd.append("images", f, f.name || 'upload.jpg');
    }
  }
  if (valid.length === 0) {
    throw new Error("No valid images to upload (must be non-empty image files)");
  }
  fd.append("model", model);
  fd.append("confidence", String(confidence));
  const res = await fetch(`${BASE}/api/detect/bulk/`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (data && typeof data === 'object') {
        if (data.detail) detail = String(data.detail);
        else if (data.images) {
          // Flatten field errors from DRF
          const firstKey = Object.keys(data.images)[0];
          const errs = Array.isArray(data.images[firstKey]) ? data.images[firstKey].join('; ') : String(data.images[firstKey]);
          detail = `images: ${errs}`;
        } else detail = JSON.stringify(data);
      }
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`Bulk submit failed: HTTP ${res.status}${detail ? ' - ' + detail : ''}`);
  }
  return res.json(); // { bulk_job_id }
}

export async function listBulkJobs() {
  const res = await fetch(`${BASE}/api/bulk_jobs/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function listJobs() {
  const res = await fetch(`${BASE}/api/jobs/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export function downloadUrl(kind, fname) {
  // kind: 'excel' | 'labels' | 'image'
  const base = `${BASE}/api`;
  if (kind === 'excel') return `${base}/download/excel/${fname}`;
  if (kind === 'labels') return `${base}/download/${fname}`;
  if (kind === 'image') return `${base}/download/image/${fname}`;
  throw new Error("unknown download kind");
}
