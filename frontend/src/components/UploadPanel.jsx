import { useEffect, useRef, useState } from "react";

/**
 * Left panel (input). Keeps aspect ratio and computes display size (disp)
 * used by the right panel to match dimensions.
 */
export default function UploadPanel({ onFile, imageURL, onRun, busy, disp, setDisp }){
  const [drag, setDrag] = useState(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 0);

  useEffect(()=>{
    const cvs = canvasRef.current;
    if(!cvs) return;

    const wrap = wrapRef.current;
    const targetW = Math.max(240, Math.floor((wrap?.clientWidth || 360)));
    const targetH = Math.floor(targetW * (640/360)); // keep 9:16 portrait ratio
    const dpr = window.devicePixelRatio || 1;

    const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#f3f4f6';

    if(!imageURL){
      cvs.width = Math.round(targetW * dpr);
      cvs.height = Math.round(targetH * dpr);
      cvs.style.width = targetW + "px";
      cvs.style.height = targetH + "px";
      const ctx = cvs.getContext("2d");
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,targetW,targetH);
      // neutral background when no image
      ctx.fillStyle = cssBg;
      ctx.fillRect(0,0,targetW,targetH);
      setDisp({ width: targetW, height: targetH, dpr });
      return;
    }

    const img = new Image();
    img.onload = ()=>{
      cvs.width = Math.round(targetW * dpr);
      cvs.height = Math.round(targetH * dpr);
      cvs.style.width = targetW + "px";
      cvs.style.height = targetH + "px";

      const ctx = cvs.getContext("2d");
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,targetW,targetH);
      // Letterbox: preserve aspect ratio inside fixed canvas
      const iw = img.naturalWidth || targetW;
      const ih = img.naturalHeight || targetH;
      const scale = Math.min(targetW / iw, targetH / ih);
      const dw = Math.round(iw * scale);
      const dh = Math.round(ih * scale);
      const dx = Math.round((targetW - dw) / 2);
      const dy = Math.round((targetH - dh) / 2);
      // background bars
      ctx.fillStyle = cssBg;
      ctx.fillRect(0,0,targetW,targetH);
      ctx.drawImage(img, dx, dy, dw, dh);

      setDisp({ width: targetW, height: targetH, dpr });
    };
    img.src = imageURL;
  }, [imageURL, vw]);

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
    <div className={"panel"+(drag?" dragover":"")}
      onDragEnter={onDragEnter} onDragOver={prevent} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="drop-hint"></div>
      <div ref={wrapRef} style={{width:"100%", display:"flex",justifyContent:"center", position:'relative'}}>
        {!imageURL && (
          <div className="empty-hint">Drop image here or click Select</div>
        )}
        <canvas ref={canvasRef} onDoubleClick={()=> fileInputRef.current?.click()} />
      </div>

      {/* Overlayed controls at the bottom of the image */}
      <div className="overlay-controls">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e)=> handleSelect(e.target.files?.[0]||null)}
          style={{ display: "none" }}
        />
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button
            className="btn ghost"
            type="button"
            onClick={()=> fileInputRef.current?.click()}
            disabled={busy}
            title="Select an image file"
          >
            Select Image
          </button>
          {imageURL && (
            <button
              className="btn ghost"
              type="button"
              onClick={()=> onFile(null)}
              disabled={busy}
              title="Clear current image"
            >
              Clear
            </button>
          )}
        </div>
        <button className="btn" onClick={onRun} disabled={busy || !imageURL}>
          {busy ? (
            <span style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              <span className="spinner" aria-hidden /> Processing…
            </span>
          ) : "Start Processing"}
        </button>
      </div>

      {/* Small tip as an overlayed info badge in top-right */}
      <div className="tip">
        <button className="tip-badge" aria-label="Tip about uploading">i</button>
        <div className="tip-content">Drag a sample image into this panel.</div>
      </div>

      {busy && (
        <div className="busy-overlay" aria-live="polite" aria-busy="true">
          <div className="busy-box">
            <span className="spinner" aria-hidden />
            <span>Processing image…</span>
          </div>
        </div>
      )}
    </div>
  );
}
