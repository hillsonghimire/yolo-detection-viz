import { useEffect, useRef } from "react";

/**
 * Draw OBB polygons onto a canvas above the image.
 * Props:
 * - image: HTMLImageElement (already loaded)
 * - detections: [{ class, class_id, confidence, polygon:[x1,y1,...,x4,y4] }]
 * - meta: { image_width, image_height }  (coming from backend)
 * - width: number (display width for the image/canvas)
 */
export default function ObbCanvas({ image, detections, meta, width = 900 }) {
  const canvasRef = useRef(null);

  // scale source -> display so polygons line up with the drawn <img>
  const srcW = meta?.image_width || image?.naturalWidth || 1;
  const srcH = meta?.image_height || image?.naturalHeight || 1;
  const aspect = srcH / srcW;
  const displayW = width;
  const displayH = Math.round(width * aspect);
  const sx = displayW / srcW;
  const sy = displayH / srcH;

  useEffect(() => {
    if (!canvasRef.current || !image) return;

    const cvs = canvasRef.current;
    cvs.width = displayW;
    cvs.height = displayH;

    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // styling
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#39ff14"; // neon green
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";

    (detections || []).forEach((d) => {
      const p = d.polygon || [];
      if (p.length < 8) return;

      // scale polygon points
      const pts = [
        [p[0] * sx, p[1] * sy],
        [p[2] * sx, p[3] * sy],
        [p[4] * sx, p[5] * sy],
        [p[6] * sx, p[7] * sy],
      ];

      // polygon
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();

      // label background anchored near the first vertex
      const label = `${d.class} ${Math.round(d.confidence * 1000) / 10}%`;
      const padX = 6, padY = 4;
      const textW = ctx.measureText(label).width;
      const boxW = textW + padX * 2;
      const boxH = 20;

      // pick a spot slightly above the first edge
      const lx = Math.max(0, Math.min(displayW - boxW, pts[0][0]));
      const ly = Math.max(0, pts[0][1] - boxH - 4);

      ctx.fillRect(lx, ly, boxW, boxH);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, lx + padX, ly + boxH - 6);
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)"; // restore fill for next label bg
    });
  }, [image, detections, displayW, displayH, sx, sy]);

  return (
    <div style={{ position: "relative", width: displayW, height: displayH }}>
      {/* the image element underneath */}
      <img
        src={image?.src}
        alt="preview"
        style={{ width: displayW, height: displayH, display: "block" }}
      />
      {/* overlay canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: displayW,
          height: displayH,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
