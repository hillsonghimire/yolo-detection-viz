import React, { useMemo, useRef, useState } from "react";
import ModelSelector from "./components/ModelSelector.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import DetectPanel from "./components/DetectPanel.jsx";
import ConfidenceRail from "./components/ConfidenceRail.jsx";
import SampleGallery from "./components/SampleGallery.jsx";
import { detectOnce } from "./lib/api.js";
import "./styles.css";

export default function App(){
  const [model, setModel] = useState("spike");
  const [file, setFile] = useState(null);
  const [imageURL, setImageURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState([]);
  const [meta, setMeta] = useState(null);
  const [conf, setConf] = useState(0.3);
  const [msg, setMsg] = useState("");

  // display dimensions shared by both canvases (keeps sizes identical)
  const [disp, setDisp] = useState({ width: 0, height: 0, dpr: 1 });
  const urlRef = useRef(null);

  const filtered = useMemo(
    () => raw.filter(d => (d.confidence ?? d.conf ?? 0) >= conf),
    [raw, conf]
  );

  const setNewFile = (f)=>{
    setFile(f || null);
    setRaw([]); setMeta(null); setMsg("");
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = f ? URL.createObjectURL(f) : null;
    setImageURL(urlRef.current || "");
  };

  const onRun = async ()=>{
    if (!file) return;
    setBusy(true); setMsg("");
    try{
      // ONE request; later filtering is client-side
      const data = await detectOnce({ file, model, minConf: 0.05 });
      const dets = Array.isArray(data?.detections) ? data.detections : [];
      setRaw(dets);
      if (data?.image_width && data?.image_height) {
        setMeta({ image_width: data.image_width, image_height: data.image_height });
      }
      if (dets.length){
        const s = dets.map(d => d.confidence ?? d.conf ?? 0).sort((a,b)=>a-b);
        const m = s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2;
        setConf(Math.max(0.05, Math.min(0.8, m)));
      }
    }catch(e){
      setMsg(String(e.message || e));
    }finally{ setBusy(false); }
  };

  const onPickSample = async (url)=>{
    const resp = await fetch(url);
    const blob = await resp.blob();
    const f = new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
    setNewFile(f);
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Wheat Detection System</h1>
        <a href="#" className="small">Detailed Operation Guide</a>
      </div>
      <p className="sub">Upload an image to detect wheat spikes / spikelets with AI.</p>

      <div className="topbar">
        <ModelSelector model={model} setModel={setModel} />
        <div className="legend">
          <span className="badge">Detections: {filtered.length} / {raw.length}</span>
          {meta && <span className="badge">Source: {meta.image_width}×{meta.image_height}</span>}
        </div>
      </div>

      <div className="grid">
        <div className="cards">
          <div className="card">
            <h3>Upload Image</h3>
            <UploadPanel
              onFile={setNewFile}
              imageURL={imageURL}
              onRun={onRun}
              busy={busy}
              disp={disp}
              setDisp={setDisp}
            />
          </div>
          <div className="card">
            <h3>Detection Result</h3>
            <DetectPanel
              imageURL={imageURL}
              detections={filtered}
              meta={meta}
              disp={disp}
            />
          </div>
        </div>
        <div className="slider-col card">
          <ConfidenceRail value={conf} onChange={setConf} />
        </div>
      </div>

      {msg && <div style={{color:"#d33", marginTop:8}}>{msg}</div>}

      <SampleGallery model={model} onPick={onPickSample} />
    </div>
  );
}



// import React, { useEffect, useMemo, useRef, useState } from "react";
// import { detectOnce } from "./api.js";
// import Controls from "./components/Controls.jsx";
// import OBBViewer from "./components/OBBViewer.jsx";
// import Uploader from "./components/Uploader.jsx";

// export default function App(){
//   const [imageFile, setImageFile] = useState(null);
//   const [imageURL, setImageURL] = useState(null);
//   const [rawDetections, setRawDetections] = useState([]); // full set from backend (one request)
//   const [meta, setMeta] = useState(null);                 // {image_width, image_height}
//   const [threshold, setThreshold] = useState(0.3);
//   const [showLabels, setShowLabels] = useState(true);
//   const [lineWidth, setLineWidth] = useState(2);
//   const [busy, setBusy] = useState(false);
//   const [error, setError] = useState("");

//   // URL cleanup
//   useEffect(()=>()=>{ if(imageURL) URL.revokeObjectURL(imageURL) },[imageURL]);

//   const filtered = useMemo(()=> rawDetections.filter(d => (d.confidence ?? d.conf ?? 0) >= threshold), [rawDetections, threshold]);

//   const onFile = (f)=>{
//     setImageFile(f || null);
//     setError("");
//     if(f){ setImageURL(URL.createObjectURL(f)); }
//     else { setImageURL(null); setRawDetections([]); setMeta(null); }
//   };

//   const onRun = async ()=>{
//     if(!imageFile){ setError("Choose an image first."); return; }
//     setBusy(true); setError("");
//     try{
//       // IMPORTANT: we do only one request here.
//       // Ask backend for a low threshold to receive the full set, then we filter client-side.
//       const data = await detectOnce(imageFile, { min_conf: 0.05 });
//       // Normalize detections & meta
//       const { detections, meta } = normalizeResponse(data);
//       setRawDetections(detections || []);
//       setMeta(meta || null);
//       // Optional: auto-adjust slider suggestion
//       if(detections && detections.length){
//         const med = median(detections.map(d => d.confidence ?? 0));
//         if(med>0){ setThreshold(Math.max(0.1, Math.min(0.8, med))); }
//       }
//     }catch(e){
//       setError(e?.message || String(e));
//     }finally{
//       setBusy(false);
//     }
//   };

//   return (
//     <div className="container">
//       <h2 style={{marginTop:8, marginBottom:12}}>OBB Detection Viewer</h2>
//       <div className="row">
//         <div className="col card">
//           <div className="label">1) Upload & Run</div>
//           <Uploader onFile={onFile} />
//           <div style={{display:'flex', gap:8, marginTop:10}}>
//             <button className="btn" onClick={onRun} disabled={!imageFile||busy}>
//               {busy ? "Running..." : "Run detection (one request)"}
//             </button>
//             {error && <div className="small" style={{color:'#ffb4b4'}}>{error}</div>}
//           </div>
//           <hr/>
//           <div className="label">2) Display Controls (client-side filter)</div>
//           <Controls
//             threshold={threshold}
//             setThreshold={setThreshold}
//             showLabels={showLabels}
//             setShowLabels={setShowLabels}
//             lineWidth={lineWidth}
//             setLineWidth={setLineWidth}
//           />
//         </div>
//         <div className="col card">
//           <div className="label">Preview</div>
//           <OBBViewer
//             imageURL={imageURL}
//             detections={filtered}
//             rawDetections={rawDetections}
//             meta={meta}
//             showLabels={showLabels}
//             lineWidth={lineWidth}
//           />
//           <div className="legend" style={{marginTop:10}}>
//             <span className="badge">Detections: {filtered.length} / {rawDetections.length}</span>
//             {meta && <span className="badge">Src: {meta.image_width}×{meta.image_height}</span>}
//           </div>
//         </div>
//       </div>
//       <p className="small" style={{marginTop:12}}>
//         Slider updates never call the backend. Detection results are filtered and re-rendered entirely in the browser.
//       </p>
//     </div>
//   );
// }

// // ---- helpers ----
// function median(arr){
//   if(!arr.length) return 0;
//   const s = [...arr].sort((a,b)=>a-b);
//   const m = Math.floor(s.length/2);
//   return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
// }

// export function normalizeResponse(data){
//   // Accept various shapes from common backends (Ultralytics, custom, etc.)
//   // Goal: return { detections:[{class, class_id, confidence, poly:[x1,y1,...,x4,y4]}], meta:{image_width, image_height} }
//   const out = { detections: [], meta: null };

//   // Try detect meta
//   const iw = data?.image_width || data?.meta?.image_width || data?.meta?.width || data?.width;
//   const ih = data?.image_height || data?.meta?.image_height || data?.meta?.height || data?.height;
//   if(iw && ih) out.meta = { image_width: iw, image_height: ih };

//   // Common lists
//   const items = data?.detections || data?.boxes || data?.objects || data?.results || data || [];
//   const arr = Array.isArray(items) ? items : [];

//   for(const r of arr){
//     const cls = r.class ?? r.name ?? r.label ?? r.cls ?? "obj";
//     const clsId = r.class_id ?? r.classId ?? r.id ?? r.cls_id ?? null;
//     const conf = r.confidence ?? r.conf ?? r.score ?? r.prob ?? 0;

//     // various polygon forms
//     let poly = null;
//     if(Array.isArray(r.poly) && r.poly.length===8) poly = r.poly;
//     else if(Array.isArray(r.polygon) && r.polygon.length===8) poly = r.polygon;
//     else if(Array.isArray(r.xyxyxyxy) && r.xyxyxyxy.length===8) poly = r.xyxyxyxy;
//     else if(Array.isArray(r.points) && r.points.length===8) poly = r.points;

//     // obb param form -> polygon
//     if(!poly && r.obb && typeof r.obb === 'object'){
//       const { x, y, w, h, angle } = r.obb;
//       if([x,y,w,h,angle].every(v => typeof v === 'number')){
//         poly = obbToPolygon(x,y,w,h,angle);
//       }
//     }

//     // axis-aligned fallback
//     if(!poly && r.box && typeof r.box === 'object'){
//       const { x1, y1, x2, y2 } = r.box;
//       if([x1,y1,x2,y2].every(v => typeof v === 'number')){
//         poly = [x1,y1, x2,y1, x2,y2, x1,y2];
//       }
//     }

//     if(poly && poly.length===8){
//       out.detections.push({ class: cls, class_id: clsId, confidence: conf, poly });
//     }
//   }
//   return out;
// }

// function obbToPolygon(cx, cy, w, h, angleRad){
//   const hx=w/2, hy=h/2;
//   const pts=[[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]];
//   const c=Math.cos(angleRad), s=Math.sin(angleRad);
//   const out=[];
//   for(const [px,py] of pts){
//     const rx = px*c - py*s;
//     const ry = px*s + py*c;
//     out.push(cx+rx, cy+ry);
//   }
//   return out;
// }
