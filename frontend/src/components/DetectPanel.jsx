import { useEffect, useMemo, useRef } from "react";

/**
 * Right panel (detection). Uses the SAME disp width/height as UploadPanel.
 * - Per-class colors (stable hash → HSL)
 * - Legend (top-right)
 */
export default function DetectPanel({
  imageURL,
  detections,
  meta,
  disp,
  showLabels = true,
  lineWidth = 2,
}) {
  const canvasRef = useRef(null);

  // Build list of classes present and a color map (stable across renders)
  const { classList, colorOf } = useMemo(() => {
    const seen = new Map(); // key -> {name, idx}
    const order = [];
    const hash = (s) => {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    const colorOfKey = (key) => {
      // Map hash to pleasant HSL palette
      const h = hash(String(key)) % 360;
      const s = 72; // %
      const l = 52; // %
      return {
        stroke: `hsl(${h} ${s}% ${Math.max(l - 8, 30)}%)`,
        fill: `hsl(${h} ${s}% ${l}% / 0.18)`,
        chip: `hsl(${h} ${s}% ${l}%)`,
      };
    };

    (detections || []).forEach((d) => {
      const key =
        d.class != null ? String(d.class) :
        d.class_id != null ? String(d.class_id) :
        "obj";
      if (!seen.has(key)) {
        seen.set(key, { name: key, color: colorOfKey(key) });
        order.push(key);
      }
    });

    const colorOf = (key) =>
      (seen.get(String(key)) || { color: colorOfKey(String(key)) }).color;

    return { classList: order.map((k) => ({ key: k, ...seen.get(k) })), colorOf };
  }, [detections]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !imageURL || !disp?.width) return;

    const { width: dispW, height: dispH, dpr = 1 } = disp;
    cvs.width = Math.round(dispW * dpr);
    cvs.height = Math.round(dispH * dpr);
    cvs.style.width = dispW + "px";
    cvs.style.height = dispH + "px";

    const ctx = cvs.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dispW, dispH);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, dispW, dispH);

      const srcW = meta?.image_width || img.naturalWidth;
      const srcH = meta?.image_height || img.naturalHeight;
      const sx = dispW / srcW;
      const sy = dispH / srcH;

      ctx.lineWidth = lineWidth;
      const fontSize = 12;
      ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
      ctx.textBaseline = "top";

      // ---- draw detections per class color
      for (const d of detections || []) {
        const p = d.poly || d.polygon || d.xyxyxyxy || d.points;
        if (!Array.isArray(p) || p.length !== 8) continue;

        const key =
          d.class != null ? String(d.class) :
          d.class_id != null ? String(d.class_id) :
          "obj";
        const col = colorOf(key);

        const pts = [
          [p[0] * sx, p[1] * sy],
          [p[2] * sx, p[3] * sy],
          [p[4] * sx, p[5] * sy],
          [p[6] * sx, p[7] * sy],
        ];

        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = col.fill;
        ctx.strokeStyle = col.stroke;
        ctx.fill();
        ctx.stroke();

        if (showLabels) {
          const name =
            d.class_name ??
            (d.class != null ? String(d.class) :
            d.class_id != null ? `cls ${d.class_id}` : "obj");
          const confPct = Math.round(((d.confidence ?? 0) * 1000)) / 10;
          const label = `${name} ${confPct}%`;

          const x = Math.min(...pts.map((pt) => pt[0]));
          const y = Math.min(...pts.map((pt) => pt[1]));
          const padX = 5,
            padY = 3;
          const tw = ctx.measureText(label).width;
          const th = fontSize + 2 * padY;

          // label chip with class color
          ctx.fillStyle = col.chip;
          ctx.fillRect(x, y - th - 2, tw + 2 * padX, th);
          // thin dark outline for readability
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y - th - 2, tw + 2 * padX, th);

          ctx.fillStyle = "#fff";
          ctx.fillText(label, x + padX, y - th - 2 + padY);
        }
      }

      // ---- draw legend (top-right)
      if (classList.length) {
        const title = "Legend";
        const pad = 8;
        const gap = 6;
        const swatch = 14;
        const lineH = Math.max(18, fontSize + 6);

        // measure width
        let w = ctx.measureText(title).width;
        for (const it of classList) {
          w = Math.max(w, swatch + 8 + ctx.measureText(it.name).width);
        }
        w = Math.ceil(w + pad * 2);
        const h = Math.ceil(pad * 2 + (lineH * classList.length) + fontSize + 6);

        const x0 = dispW - w - 10; // 10px from right
        const y0 = 10;             // 10px from top

        // panel
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect
          ? ctx.roundRect(x0, y0, w, h, 8)
          : (ctx.rect(x0, y0, w, h));
        ctx.fill();
        ctx.stroke();

        // title
        ctx.fillStyle = "#334155";
        ctx.fillText(title, x0 + pad, y0 + pad);

        // entries
        let y = y0 + pad + fontSize + 6;
        for (const it of classList) {
          ctx.fillStyle = it.color.chip;
          ctx.fillRect(x0 + pad, y + (lineH - swatch) / 2, swatch, swatch);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.strokeRect(x0 + pad, y + (lineH - swatch) / 2, swatch, swatch);

          ctx.fillStyle = "#111827";
          ctx.fillText(it.name, x0 + pad + swatch + 8, y + (lineH - fontSize) / 2);
          y += lineH;
        }
      }
    };
    img.src = imageURL;
  }, [imageURL, detections, meta, disp, showLabels, lineWidth, classList, colorOf]);

  return (
    <div className="panel">
      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
