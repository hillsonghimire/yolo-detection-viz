// One-time detection call. Slider filtering is client-side.
const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export async function detectOnce({ file, model, minConf = 0.05 }){
  const fd = new FormData();
  fd.append("image", file);     // Django view expects 'image' (or handle both)
  fd.append("model", model);    // spike | spikelet | third
  fd.append("conf", String(minConf));

  const res = await fetch(`${BASE}/api/detect/basic/`, {
    method: "POST",
    body: fd,
    headers: { "Accept": "application/json" },
    credentials: "omit"
  });
  if(!res.ok){
    const msg = await res.text().catch(()=>"" );
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return res.json();
}
