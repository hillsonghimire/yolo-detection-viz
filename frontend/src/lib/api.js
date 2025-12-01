// One-time detection call. Slider filtering is client-side.
// Resolve API base in order:
// 1) Explicit VITE_API_BASE / VITE_API_URL (set via .env)
// 2) Browser origin with optional VITE_API_PORT override for localhost
// 3) Fallback to http://localhost:8000 for non-browser contexts
const resolvedBase = (() => {
  const envPort = (() => {
    const raw = (import.meta.env?.VITE_API_PORT || "").trim();
    if (!raw) return "";
    return raw.replace(/^:/, "");
  })();

  const ensureProtocol = (urlStr) => {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(urlStr)) return urlStr;
    return `https://${urlStr}`;
  };

  const normalize = (urlStr) => {
    try {
      const u = new URL(ensureProtocol(urlStr));
      const host = u.hostname;
      let port = "";
      if (["localhost", "127.0.0.1"].includes(host)) {
        port = u.port ? `:${u.port}` : "";
        if (!port && envPort) {
          port = `:${envPort}`;
        }
      }
      // Avoid double-prefixing /api when the base URL already includes it.
      let path = u.pathname.replace(/\/+$/, "");
      if (path === "/api") {
        path = "";
      }
      const origin = `${u.protocol}//${host}${port}`;
      return `${origin}${path}`.replace(/\/$/, "");
    } catch {
      let cleaned = ensureProtocol(urlStr).replace(/\/$/, "");
      if (/\/api$/i.test(cleaned)) {
        cleaned = cleaned.replace(/\/api$/i, "");
      }
      if (envPort && !/:\d+$/.test(cleaned) && /localhost|127\.0\.0\.1/.test(cleaned)) {
        cleaned = `${cleaned}:${envPort}`;
      }
      return cleaned;
    }
  };

  const envBase = (import.meta.env?.VITE_API_BASE || import.meta.env?.VITE_API_URL || "").trim();
  if (envBase) return normalize(envBase);
  if (typeof window !== "undefined" && window.location) {
    const { protocol, hostname, port } = window.location;
    const host = hostname || 'localhost';
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const finalPort = isLocal ? (envPort || "8000") : (port || "");
    const portSuffix = finalPort ? `:${String(finalPort).replace(/^:/, "")}` : "";
    return `${protocol}//${host}${portSuffix}`;
  }
  const fallbackPort = envPort || "8000";
  return `http://localhost:${fallbackPort}`;
})();
const BASE = resolvedBase;
const API_TIMEOUT_MS = (() => {
  const raw = (import.meta.env?.VITE_API_TIMEOUT_MS || "").trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 120_000; // 2 minutes default
})();

export async function detectOnce({ file, model, minConf = 0.05 }){
  const fd = new FormData();
  fd.append("image", file);     // Django view expects 'image' (or handle both)
  fd.append("model", model);    // spike | spikelet | fdk | fhb
  fd.append("conf", String(minConf));

  const controller = new AbortController();
  const timeout = API_TIMEOUT_MS > 0 ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : null;
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
      const secs = API_TIMEOUT_MS > 0 ? Math.round(API_TIMEOUT_MS / 1000) : null;
      const pretty = secs ? `${secs}s` : `${API_TIMEOUT_MS}ms`;
      throw new Error(`Request timed out after ${pretty}`);
    }
    throw e;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if(!res.ok){
    const msg = await res.text().catch(()=>"" );
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return res.json();
}

export async function runFhbFieldPipeline({ file, files = [], runName = "" }) {
  const fd = new FormData();
  const list = [];
  for (const f of files || []) {
    if (f && typeof f.size === "number" && f.size > 0) list.push(f);
  }
  if (file && list.length === 0) list.push(file);
  if (list.length === 0) {
    throw new Error("No images provided for FHB field pipeline");
  }
  list.forEach((f) => fd.append("images", f, f.name || "upload.jpg"));
  if (runName) fd.append("run_name", runName);

  const res = await fetch(`${BASE}/api/pipeline/fhb-field/`, { method: "POST", body: fd });
  if (!res.ok) {
    let msg = "";
    try { msg = await res.text(); } catch {}
    throw new Error(`FHB field pipeline failed (HTTP ${res.status}${msg ? ` - ${msg}` : ""})`);
  }
  return res.json();
}

// ---- Bulk processing APIs ----
export async function submitBulk({ files, model, confidence = 0.25, kernelParams = null }) {
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
  if ((model || "").toLowerCase() === "kernel") {
    const kp = kernelParams || {};
    const sidemm = kp.sidemm ?? 40;
    const allowed = kp.allowedIds ?? kp.allowed_ids ?? "425,100,201,310";
    const useSam = !!kp.useSam;
    const samCheckpoint = kp.samCheckpoint || kp.sam_checkpoint || "";
    const samModelType = kp.samModelType || kp.sam_model_type || "vit_b";
    fd.append("sidemm", String(sidemm));
    fd.append("allowed_ids", String(allowed));
    fd.append("use_sam", useSam ? "true" : "false");
    fd.append("sam_checkpoint", samCheckpoint);
    fd.append("sam_model_type", samModelType);
  }
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

export function downloadMedia(relPath) {
  const cleaned = String(relPath || "").replace(/^\\+|^\/+/, "");
  return `${BASE}/api/download/media/${cleaned}`;
}

// ---- Kernel measurement APIs ----
export async function measureKernel({ file, model = 'kernel', sidemm, allowedIds = '0,1,2,3', useSam = false, samCheckpoint = '', samModelType = 'vit_b' }){
  const fd = new FormData();
  fd.append('image', file);
  fd.append('model', model);
  fd.append('sidemm', String(sidemm));
  fd.append('allowed_ids', String(allowedIds));
  fd.append('use_sam', String(Boolean(useSam)));
  if (samCheckpoint) fd.append('sam_checkpoint', samCheckpoint);
  fd.append('sam_model_type', samModelType);
  const res = await fetch(`${BASE}/api/measure/kernel/`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { unique_id }
}

export async function getJob(jobId){
  const res = await fetch(`${BASE}/api/jobs/${jobId}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function downloadMeasure(kind, fname){
  const base = `${BASE}/api/download/measure`;
  if (kind === 'image') return `${base}/image/${fname}`;
  if (kind === 'csv') return `${base}/csv/${fname}`;
  throw new Error('unknown measure download kind');
}
