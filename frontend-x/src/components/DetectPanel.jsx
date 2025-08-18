import { useEffect, useRef } from "react";

/**
 * Right panel (detection). Uses the SAME disp width/height as UploadPanel.
 */
export default function DetectPanel({ imageURL, detections, meta, disp, showLabels=true, lineWidth=2 }){
  const canvasRef = useRef(null);

  useEffect(()=>{
    const cvs = canvasRef.current;
    if(!cvs || !imageURL || !disp?.width) return;

    const { width: dispW, height: dispH, dpr=1 } = disp;
    cvs.width = Math.round(dispW * dpr);
    cvs.height = Math.round(dispH * dpr);
    cvs.style.width = dispW + "px";
    cvs.style.height = dispH + "px";

    const ctx = cvs.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,dispW,dispH);

    const img = new Image();
    img.onload = ()=>{
      ctx.drawImage(img, 0,0, dispW, dispH);

      const srcW = meta?.image_width || img.naturalWidth;
      const srcH = meta?.image_height || img.naturalHeight;
      const sx = dispW / srcW;
      const sy = dispH / srcH;

      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = "#45d1ff";
      ctx.fillStyle = "rgba(17,112,255,0.15)";
      const fontSize = 12;
      ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
      ctx.textBaseline = "top";

      for(const d of detections || []){
        const p = d.poly || d.polygon || d.xyxyxyxy || d.points;
        if(!Array.isArray(p) || p.length!==8) continue;

        const pts = [
          [p[0]*sx, p[1]*sy],
          [p[2]*sx, p[3]*sy],
          [p[4]*sx, p[5]*sy],
          [p[6]*sx, p[7]*sy],
        ];
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

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
          ctx.fillStyle = "rgba(17,112,255,0.15)";
        }
      }
    };
    img.src = imageURL;
  }, [imageURL, detections, meta, disp, showLabels, lineWidth]);

  return (
    <div className="panel">
      <div className="canvas-wrap">
        <canvas ref={canvasRef}/>
      </div>
    </div>
  );
}
