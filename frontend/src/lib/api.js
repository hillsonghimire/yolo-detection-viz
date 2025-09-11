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
  for (const f of files || []) fd.append("images", f);
  fd.append("model", model);
  fd.append("confidence", String(confidence));
  const res = await fetch(`${BASE}/api/detect/bulk/`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Bulk submit failed: HTTP ${res.status} ${msg}`);
  }
  return res.json(); // { bulk_job_id }
}

export async function listBulkJobs() {
  const res = await fetch(`${BASE}/api/bulk_jobs/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // array of BulkDetectionJob
}

export async function listJobs() {
  const res = await fetch(`${BASE}/api/jobs/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // array of DetectionJob
}

export function downloadUrl(kind, fname) {
  // kind: 'excel' | 'labels' | 'image'
  const base = `${BASE}/api`;
  if (kind === 'excel') return `${base}/download/excel/${fname}`;
  if (kind === 'labels') return `${base}/download/${fname}`;
  if (kind === 'image') return `${base}/download/image/${fname}`;
  throw new Error("unknown download kind");
}
