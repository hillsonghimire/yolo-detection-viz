import { useEffect, useRef, useState } from "react";

/**
 * Left panel (input). Keeps aspect ratio and computes display size (disp)
 * used by the right panel to match dimensions.
 */
export default function UploadPanel({ onFile, imageURL, onRun, busy, disp, setDisp }){
  const [drag, setDrag] = useState(false);
  const canvasRef = useRef(null);

  useEffect(()=>{
    const cvs = canvasRef.current;
    if(!cvs) return;

    if(!imageURL){
      const ctx = cvs.getContext("2d");
      cvs.width = 800; cvs.height = 600;
      ctx.clearRect(0,0,cvs.width,cvs.height);
      setDisp({ width: 0, height: 0, dpr: window.devicePixelRatio || 1 });
      return;
    }

    const img = new Image();
    img.onload = ()=>{
      const maxW = 540; // target panel width; adjust if your card is wider
      const dispW = Math.min(maxW, img.naturalWidth);
      const dispH = Math.round(dispW * (img.naturalHeight / img.naturalWidth));
      const dpr = window.devicePixelRatio || 1;

      cvs.width = Math.round(dispW * dpr);
      cvs.height = Math.round(dispH * dpr);
      cvs.style.width = dispW + "px";
      cvs.style.height = dispH + "px";

      const ctx = cvs.getContext("2d");
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,dispW,dispH);
      ctx.drawImage(img, 0,0, dispW, dispH);

      setDisp({ width: dispW, height: dispH, dpr });
    };
    img.src = imageURL;
  }, [imageURL]);

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
      <div style={{width:"100%", display:"flex",justifyContent:"center"}}>
        <canvas ref={canvasRef}/>
      </div>
      <div className="controls" style={{marginTop:10}}>
        <input type="file" accept="image/*" onChange={(e)=> handleSelect(e.target.files?.[0]||null)} />
        <button className="btn" onClick={onRun} disabled={busy || !imageURL}>
          {busy ? "Processing…" : "Start Processing"}
        </button>
      </div>
      <div className="small" style={{marginTop:6}}>Tip: drag a sample image (below) into this panel.</div>
    </div>
  );
}
