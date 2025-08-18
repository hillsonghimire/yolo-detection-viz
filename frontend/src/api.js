// Single request to backend (do not call again on slider change)
const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function detectOnce(file, opts={}){
  const fd = new FormData();
  fd.append("file", file);
  // If your backend accepts a confidence parameter, send a low one to receive all detections
  if(opts.min_conf != null) fd.append("conf", String(opts.min_conf));

  const res = await fetch(`${BASE}/api/detect/basic/`, { method: "POST", body: fd });
  if(!res.ok){
    const msg = await res.text().catch(()=>"" );
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return res.json();
}
