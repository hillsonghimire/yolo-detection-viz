import { useEffect, useRef, useState } from "react";

/**
 * Left panel (input). Keeps aspect ratio and computes display size (disp)
 * used by the right panel to match dimensions.
 */
export default function UploadPanel({ onFile, imageURL, fileName, onRun, busy, disp, setDisp }){
  const [drag, setDrag] = useState(false);
  const wrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 0);

  // Compute a shared display size for the detection canvas,
  // without rendering the input image preview.
  useEffect(() => {
    const containerW = document.querySelector('.container')?.clientWidth || window.innerWidth || 960;
    const targetW = Math.max(360, Math.min(Math.floor(containerW - 40), 1200));
    const targetH = Math.floor(targetW * (640 / 360)); // keep 9:16 portrait ratio
    const dpr = window.devicePixelRatio || 1;
    setDisp({ width: targetW, height: targetH, dpr });
  }, [vw]);

  // track viewport width to trigger re-measure on resize
  useEffect(() => {
    const onR = () => setVw(window.innerWidth || 0);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const handleSelect = (f)=> onFile(f || null);

  const prevent = e=>{ e.preventDefault(); e.stopPropagation(); };
  const onDragEnter = e=>{ prevent(e); setDrag(true); };
  const onDragLeave = e=>{ prevent(e); setDrag(false); };
  const onDrop = async e=>{
    prevent(e); setDrag(false);
    const dt = e.dataTransfer;
    if(dt?.files && dt.files[0]) return onFile(dt.files[0]);
    const url = dt.getData("text/uri-list") || dt.getData("text/plain");
    if(url){
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
      return onFile(file);
    }
  };

  return (
    <div
      className={"panel" + (drag ? " dragover" : "")}
      onDragEnter={onDragEnter}
      onDragOver={prevent}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ minHeight: 140 }}
    >
      <div className="drop-hint"></div>
      <div ref={wrapRef} style={{ width: "100%", textAlign: "center", padding: 16 }}>
        <p className="small" style={{ marginTop: 0, color: 'var(--fg)' }}>
          Drop image here or select a file
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleSelect(e.target.files?.[0] || null)}
            style={{ display: "none" }}
          />
          <button
            className="btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="Select an image file"
          >
            Choose Image
          </button>
          <button className="btn" onClick={onRun} disabled={busy || !imageURL}>
            {busy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" aria-hidden /> Processing…
              </span>
            ) : (
              "Start Processing"
            )}
          </button>
          {imageURL && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => onFile(null)}
              disabled={busy}
              title="Clear current image"
            >
              Clear
            </button>
          )}
        </div>
        <div className="small" style={{ marginTop: 8, color: imageURL ? 'var(--fg)' : 'var(--muted)' }}>
          {imageURL ? (fileName || 'Selected image') : 'No file selected'}
        </div>
      </div>
    </div>
  );
}
