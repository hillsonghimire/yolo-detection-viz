import React, { useEffect, useMemo, useRef, useState } from "react";
import ModelSelector from "./components/ModelSelector.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import DetectPanel from "./components/DetectPanel.jsx";
import ConfidenceRail from "./components/ConfidenceRail.jsx";
import SampleGallery from "./components/SampleGallery.jsx";
import BulkPanel from "./components/BulkPanel.jsx";
import { detectOnce, measureKernel, getJob, downloadMeasure } from "./lib/api.js";
import ZoomableImage from "./components/ZoomableImage.jsx";
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
  // kernel measurement state
  const [km, setKm] = useState({ sidemm: 40, allowedIds: "425,100,201,310", useSam: true, samCheckpoint: "models/sam_vit_b_01ec64.pth", samModelType: "vit_b" });
  const [kmJobId, setKmJobId] = useState("");
  const [kmOverlay, setKmOverlay] = useState("");
  const [kmCSV, setKmCSV] = useState("");

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

  const fallbackWidth = 420;
  const fallbackHeight = Math.round(fallbackWidth * 0.75);
  const placeholderWidth = Math.round(disp?.width || fallbackWidth);
  const placeholderHeight = Math.round(disp?.height || fallbackHeight);

  const setNewFile = (f) => {
    setFile(f || null);
    setRaw([]);
    setMeta(null);
    setMsg("");
    setKmJobId(""); setKmOverlay(""); setKmCSV("");
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
      if (model === 'kernel') {
        const { unique_id } = await measureKernel({
          file,
          model: 'kernel',
          sidemm: km.sidemm,
          allowedIds: km.allowedIds,
          useSam: km.useSam,
          samCheckpoint: km.samCheckpoint,
          samModelType: km.samModelType,
        });
        setKmJobId(unique_id);
        // poll job until DONE (basic, time-limited)
        const deadline = Date.now() + 60000; // 60s
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1500));
          const job = await getJob(unique_id);
          if (job?.status === 'DONE') {
            try {
              const res = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
              const ovRel = res?.measurement_overlay || '';
              const csvRel = res?.measurement_csv || '';
              if (ovRel) {
                const fname = ovRel.split('/').pop();
                setKmOverlay(downloadMeasure('image', fname));
              }
              if (csvRel) {
                const fname = csvRel.split('/').pop();
                setKmCSV(downloadMeasure('csv', fname));
              }
            } catch {}
            break;
          }
          if (job?.status === 'FAILED') {
            setMsg('Measurement failed');
            break;
          }
        }
      } else {
        // ONE request; later filtering is client-side
        const data = await detectOnce({ file, model, minConf: 0.05 });
        const dets = Array.isArray(data?.detections) ? data.detections : [];
        setRaw(dets);
        if (data?.image_width && data?.image_height) {
          setMeta({ image_width: data.image_width, image_height: data.image_height });
        }
      }
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
        <div className="brand">
          <img className="app-logo" src="/logo/Logo_2.png" alt="WheatAI logo" />
          <div className="brand-copy">
            <span className="brand-name">WheatAI</span>
            <span className="brand-tagline">Precision crop diagnostics</span>
          </div>
        </div>
        <div className="header-actions">
          <a
            className="contact-link"
            href="mailto:maitiniyazi.maimaitijiang@sdstate.edu,sunish.sehgal@sdstate.edu?subject=WheatAI%3A"
          >
            Contact us
          </a>
          <button
            className="theme-btn"
            type="button"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </div>
      </div>
      {/* <p className="sub">Upload an image to detect wheat spikes / spikelets with AI.</p> */}

      <div className="topbar">
        <ModelSelector model={model} setModel={setModel} />
        <div className="mode-toggle">
          <span className="mode-toggle__label small">Processing Mode</span>
          <div className="mode-toggle__options" role="group" aria-label="Choose processing mode">
            <button
              type="button"
              className={`mode-toggle__option ${!bulkMode ? "active" : ""}`}
              onClick={() => setBulkMode(false)}
              aria-pressed={!bulkMode}
            >
              Single
            </button>
            <button
              type="button"
              className={`mode-toggle__option ${bulkMode ? "active" : ""}`}
              onClick={() => setBulkMode(true)}
              aria-pressed={bulkMode}
            >
              Bulk
            </button>
          </div>
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

      {!bulkMode && model !== 'kernel' && (
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

      {!bulkMode && model === 'kernel' && (
        <section className="detect-frame">
          <div className="panel" style={{ flex: 1, minHeight: 120, display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-start' }}>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              {imageURL ? (
                <ZoomableImage
                  src={kmOverlay || imageURL}
                  placeholder={"Upload an image to preview it here."}
                  frameWidth={placeholderWidth}
                  frameHeight={placeholderHeight}
                  downloads={[
                    ...(kmCSV ? [{
                      href: kmCSV,
                      label: "Download CSV",
                      downloadName: kmCSV.split("/").pop() || undefined,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                      ),
                    }] : []),
                    ...(kmOverlay ? [{
                      href: kmOverlay,
                      label: "Download image",
                      downloadName: kmOverlay.split("/").pop() || undefined,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="3" width="18" height="14" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <path d="M21 17l-5-5-4 4-2-2-5 5"></path>
                        </svg>
                      ),
                    }] : []),
                  ]}
                />
              ) : (
                <div
                  className="detect-placeholder"
                  style={{ width: placeholderWidth, height: placeholderHeight }}
                >
                  <div className="placeholder-text">Upload an image to preview it here.</div>
                </div>
              )}
              {imageURL && !kmOverlay && (
                <div className="small" style={{ color: 'var(--muted)' }}>
                  Submit to generate the measurement overlay and CSV.
                </div>
              )}
            </div>
            <div style={{ padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--line)' }}>
              <label className="small">Side (mm)</label>
              <input className="input" style={{ width: 90 }} type="number" min="0.1" step="0.1" value={km.sidemm}
                onChange={(e)=> setKm(v=> ({...v, sidemm: parseFloat(e.target.value)||0}))} />
              <label className="small">ArUco IDs</label>
              <input className="input" style={{ width: 200 }} type="text" value={km.allowedIds}
                onChange={(e)=> setKm(v=> ({...v, allowedIds: e.target.value}))} placeholder="425,100,201,310" />
              <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={km.useSam} onChange={(e)=> setKm(v=> ({...v, useSam: e.target.checked}))} /> SAM
              </label>
              <input className="input" style={{ width: 240 }} type="text" disabled={!km.useSam}
                value={km.samCheckpoint} onChange={(e)=> setKm(v=> ({...v, samCheckpoint: e.target.value}))} placeholder="models/sam_vit_b_01ec64.pth" />
              <select className="select" disabled={!km.useSam} value={km.samModelType}
                onChange={(e)=> setKm(v=> ({...v, samModelType: e.target.value}))}>
                <option value="vit_b">vit_b</option>
                <option value="vit_l">vit_l</option>
                <option value="vit_h">vit_h</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {bulkMode && (
        <BulkPanel
          model={model}
          onExit={() => setBulkMode(false)}
          kernelParams={km}
          setKernelParams={setKm}
        />
      )}
    </div>
  );
}
