// One-time detection call. Slider filtering is client-side.
// Resolve API base in order (see lib/api.js for details)
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
      return `${u.protocol}//${host}${port}`.replace(/\/$/, "");
    } catch {
      let cleaned = ensureProtocol(urlStr).replace(/\/$/, "");
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
    if (host === 'localhost') {
      const localPort = envPort || "8000";
      return `${protocol}//${host}:${localPort}`;
    }
    return `${protocol}//${host}`;
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
