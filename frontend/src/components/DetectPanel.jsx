import { useEffect, useMemo, useRef, useState } from "react";

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
  imageName,
  lineWidth = 2,
}) {
  const canvasRef = useRef(null);
  const [showLabels, setShowLabels] = useState(true);
  const [legendRect, setLegendRect] = useState({ x: 0, y: 10, w: 0, h: 0 });

  // derive a sensible base name for downloads
  const imgNameBase = (() => {
    if (imageName && typeof imageName === "string") {
      return imageName.replace(/\.[^.]+$/, "") || "image";
    }
    try {
      if (imageURL) {
        const u = new URL(imageURL, window.location.href);
        const stem = (u.pathname.split("/").pop() || "image").replace(/\.[^.]+$/, "");
        return stem || "image";
      }
    } catch {}
    return "image";
  })();

  const getSourceDims = async () => {
    if (meta?.image_width && meta?.image_height) {
      return { w: meta.image_width, h: meta.image_height };
    }
    const probe = new Image();
    const dims = await new Promise((resolve) => {
      probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => resolve({ w: disp?.width || 0, h: disp?.height || 0 });
      probe.src = imageURL;
    });
    return dims;
  };

  const downloadPredImage = async () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const name = `${imgNameBase}_pred.png`;
    if (cvs.toBlob) {
      cvs.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    } else {
      const url = cvs.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const downloadLabelsTxt = async () => {
    if (!detections || !detections.length) return;
    const { w: srcW, h: srcH } = await getSourceDims();
    const lines = (detections || []).map((d) => {
      const p = d.poly || d.polygon || d.xyxyxyxy || d.points || [];
      if (!Array.isArray(p) || p.length !== 8) return null;
      let cls = d.class_id;
      if (cls == null) cls = d.class;
      if (typeof cls === "string") {
        const n = parseInt(cls, 10);
        cls = Number.isFinite(n) ? n : 0;
      }
      if (!Number.isFinite(cls)) cls = 0;
      const nx = (x) => (srcW ? x / srcW : x);
      const ny = (y) => (srcH ? y / srcH : y);
      const coords = [
        nx(p[0]), ny(p[1]),
        nx(p[2]), ny(p[3]),
        nx(p[4]), ny(p[5]),
        nx(p[6]), ny(p[7]),
      ].map((v) => (Number.isFinite(v) ? v.toFixed(6) : "0.000000"));
      return [cls, ...coords].join(" ");
    }).filter(Boolean);

    const content = lines.join("\n") + (lines.length ? "\n" : "");
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${imgNameBase}_labels.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

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
      // Letterboxed draw preserving aspect ratio
      const srcW = meta?.image_width || img.naturalWidth;
      const srcH = meta?.image_height || img.naturalHeight;
      const scale = Math.min(dispW / srcW, dispH / srcH);
      const drawW = Math.round(srcW * scale);
      const drawH = Math.round(srcH * scale);
      const offX = Math.round((dispW - drawW) / 2);
      const offY = Math.round((dispH - drawH) / 2);
      // background
      ctx.fillStyle = "#000";
      ctx.fillRect(0,0,dispW,dispH);
      ctx.drawImage(img, offX, offY, drawW, drawH);

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
          [p[0] * scale + offX, p[1] * scale + offY],
          [p[2] * scale + offX, p[3] * scale + offY],
          [p[4] * scale + offX, p[5] * scale + offY],
          [p[6] * scale + offX, p[7] * scale + offY],
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

        // publish legend rectangle for DOM overlay positioning
        const next = { x: x0, y: y0, w, h };
        setLegendRect((prev) => (prev.x !== next.x || prev.y !== next.y || prev.w !== next.w || prev.h !== next.h ? next : prev));
      }
    };
    img.src = imageURL;
  }, [imageURL, detections, meta, disp, showLabels, lineWidth, classList, colorOf]);

  return (
    <div className="panel">
      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      {imageURL && (
        <div
          className="legend-toggle"
          style={{ right: 10, top: (legendRect.y + legendRect.h + 8) }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "#334155", fontWeight: 600 }}>Labels</span>
          </label>
        </div>
      )}
      {imageURL && (
        <div className="overlay-controls">
          <button className="btn ghost" type="button" onClick={downloadLabelsTxt} disabled={!(detections && detections.length)}>
            Download Labels
          </button>
          <button className="btn ghost" type="button" onClick={downloadPredImage}>
            Download Image
          </button>
        </div>
      )}
    </div>
  );
}
