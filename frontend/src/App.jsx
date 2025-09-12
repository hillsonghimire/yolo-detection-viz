import React, { useEffect, useMemo, useRef, useState } from "react";
import ModelSelector from "./components/ModelSelector.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import DetectPanel from "./components/DetectPanel.jsx";
import ConfidenceRail from "./components/ConfidenceRail.jsx";
import SampleGallery from "./components/SampleGallery.jsx";
import BulkPanel from "./components/BulkPanel.jsx";
import { detectOnce } from "./lib/api.js";
import "./styles.css";

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? "dark" : "light";
  });
  const [model, setModel] = useState("spike");
  const [file, setFile] = useState(null);
  const [imageURL, setImageURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState([]);
  const [meta, setMeta] = useState(null);
  const [conf, setConf] = useState(0.3);
  const [msg, setMsg] = useState("");
  const [bulkMode, setBulkMode] = useState(false);

  // display dimensions shared by both canvases (keeps sizes identical)
  const [disp, setDisp] = useState({ width: 0, height: 0, dpr: 1 });
  const urlRef = useRef(null);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  // ——— helpers to keep class colors consistent with DetectPanel ———
  const hash = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const colorOfKey = (key) => {
    const h = hash(String(key)) % 360;
    const s = 72; // %
    const l = 52; // %
    return {
      chip: `hsl(${h} ${s}% ${l}%)`,               // badge background
      textOnChip: "#fff",
      dot: `hsl(${h} ${s}% ${Math.max(l - 8, 30)}%)`,
    };
  };

  const filtered = useMemo(
    () => raw.filter((d) => (d.confidence ?? d.conf ?? 0) >= conf),
    [raw, conf]
  );

  // Per-class counts for filtered (left of slash) and all raw (right of slash)
  const classCounts = useMemo(() => {
    const f = new Map();
    const r = new Map();
    const keyOf = (d) =>
      d.class != null ? String(d.class) :
      d.class_id != null ? String(d.class_id) : "obj";

    for (const d of raw) {
      const k = keyOf(d);
      r.set(k, (r.get(k) || 0) + 1);
    }
    for (const d of filtered) {
      const k = keyOf(d);
      f.set(k, (f.get(k) || 0) + 1);
    }

    // stable order: by raw count desc, then key
    const keys = Array.from(new Set([...r.keys(), ...f.keys()]));
    keys.sort((a, b) => (r.get(b) || 0) - (r.get(a) || 0) || String(a).localeCompare(String(b)));

    return { keys, f, r };
  }, [raw, filtered]);

  const setNewFile = (f) => {
    setFile(f || null);
    setRaw([]);
    setMeta(null);
    setMsg("");
    setBulkMode(false);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = f ? URL.createObjectURL(f) : null;
    setImageURL(urlRef.current || "");
  };

  const onRun = async () => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      // ONE request; later filtering is client-side
      const data = await detectOnce({ file, model, minConf: 0.05 });
      const dets = Array.isArray(data?.detections) ? data.detections : [];
      setRaw(dets);
      if (data?.image_width && data?.image_height) {
        setMeta({ image_width: data.image_width, image_height: data.image_height });
      }
      // Keep user's confidence setting stable; do not auto-adjust
    } catch (e) {
      setMsg(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onPickSample = async (url) => {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const f = new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
    setNewFile(f);
  };

  return (
    <div className="container">
      <div className="header">
        <h1>WheatAI</h1>
        {/* <a href="#" className="small">Detailed Operation Guide</a> */}
        <div className="theme-toggle">
          <button className="theme-btn" type="button" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        </div>
      </div>
      {/* <p className="sub">Upload an image to detect wheat spikes / spikelets with AI.</p> */}

      <div className="topbar">
        <ModelSelector model={model} setModel={setModel} />
        <div className="controls">
          <button className="btn" type="button" onClick={() => setBulkMode((v) => !v)}>
            {bulkMode ? "Single Image Mode" : "Bulk Processing"}
          </button>
        </div>
        {/* legend chips removed to avoid duplication; stats now inside detection panel */}
      </div>

      {!bulkMode && (
        <div className="card input-card">
          <div className="input-header">
            <h3>Select or Upload Image</h3>
            <div className="small" style={{ marginLeft: 'auto' }}>Pick a sample or upload your own</div>
          </div>
          <div className="input-grid">
            <div className="input-upload">
              <UploadPanel
                onFile={setNewFile}
                imageURL={imageURL}
                fileName={file?.name || null}
                onRun={onRun}
                busy={busy}
                disp={disp}
                setDisp={setDisp}
              />
            </div>
            <div className="input-gallery">
              <SampleGallery model={model} onPick={onPickSample} />
            </div>
          </div>
        </div>
      )}

      {msg && <div style={{ color: "#d33", marginTop: 8 }}>{msg}</div>}

      {!bulkMode && (
        <section className="detect-frame">
          <DetectPanel
            imageURL={imageURL}
            detections={filtered}
            allDetections={raw}
            meta={meta}
            disp={disp}
            imageName={file?.name || null}
            model={model}
          />
          <div className="detect-controls">
            <ConfidenceRail value={conf} onChange={setConf} />
          </div>
        </section>
      )}

      {bulkMode && (
        <BulkPanel model={model} onExit={() => setBulkMode(false)} />
      )}
    </div>
  );
}
