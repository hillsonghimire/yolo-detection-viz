import React, { useEffect, useRef, useState } from "react";

/**
 * OBBViewer draws the uploaded image on a canvas and overlays OBB polygons from detections.
 * It scales polygons from source coordinates (meta.image_width/height) to display coordinates.
 */
export default function OBBViewer({ imageURL, detections, rawDetections, meta, showLabels=true, lineWidth=2 }){
  const canvasRef = useRef(null);
  const [imgEl, setImgEl] = useState(null);
  const [displayW, setDisplayW] = useState(0);
  const [displayH, setDisplayH] = useState(0);

  // load image
  useEffect(()=>{
    if(!imageURL){ setImgEl(null); return; }
    const img = new Image();
    img.onload = ()=> setImgEl(img);
    img.src = imageURL;
    return ()=>{ /* revoke handled by parent */ };
  }, [imageURL]);

  // draw when anything changes
  useEffect(()=>{
    const canvas = canvasRef.current;
    if(!canvas || !imgEl) return;

    const srcW = meta?.image_width || imgEl.naturalWidth;
    const srcH = meta?.image_height || imgEl.naturalHeight;

    // Display at max container width (CSS), keep aspect
    const cssMaxW = Math.min(1000, window.innerWidth - 80);
    let dispW = Math.min(cssMaxW, imgEl.naturalWidth);
    let dispH = Math.round(dispW * (imgEl.naturalHeight / imgEl.naturalWidth));

    // support very small screens fallback
    if(dispW < 360){
      dispW = 360;
      dispH = Math.round(dispW * (imgEl.naturalHeight / imgEl.naturalWidth));
    }

    // scale to devicePixels
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width  = dispW + "px";
    canvas.style.height = dispH + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0,0,dispW,dispH);

    // draw image
    ctx.drawImage(imgEl, 0, 0, dispW, dispH);

    // compute scale from source to display
    const sx = dispW / srcW;
    const sy = dispH / srcH;

    // draw polygons
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = "#45d1ff";
    ctx.fillStyle = "rgba(17, 112, 255, 0.15)";
    const fontSize = 12;
    ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
    ctx.textBaseline = "top";

    for(const d of detections){
      const p = d.poly || d.polygon || d.xyxyxyxy || d.points;
      if(!Array.isArray(p) || p.length !== 8) continue;
      const pts = [
        [p[0]*sx, p[1]*sy],
        [p[2]*sx, p[3]*sy],
        [p[4]*sx, p[5]*sy],
        [p[6]*sx, p[7]*sy],
      ];

      // polygon fill & stroke
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if(showLabels){
        const label = `${d.class ?? "obj"} ${(Math.round((d.confidence ?? 0)*1000)/10)}%`;
        const x = Math.min(...pts.map(pt=>pt[0]));
        const y = Math.min(...pts.map(pt=>pt[1]));
        const padX = 4, padY = 2;
        const tw = ctx.measureText(label).width;
        const th = fontSize + 2*padY;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(x, y - th - 2, tw + 2*padX, th);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + padX, y - th - 2 + padY);
        ctx.fillStyle = "rgba(17, 112, 255, 0.15)"; // restore
      }
    }

    setDisplayW(dispW); setDisplayH(dispH);
  }, [imgEl, detections, meta, showLabels, lineWidth]);

  if(!imageURL) return <div className="small">Upload an image to see results.</div>;
  if(!rawDetections?.length) return <div className="small">No detections yet. Click <b>Run detection</b>.</div>;

  return (
    <div className="img-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
