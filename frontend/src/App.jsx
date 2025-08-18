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
