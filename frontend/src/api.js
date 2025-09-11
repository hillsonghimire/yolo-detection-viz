// One-time detection call. Slider filtering is client-side.
// Resolve API base robustly (see lib/api.js for notes)
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
