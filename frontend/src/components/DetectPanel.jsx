import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Right panel (detection). Uses the SAME disp width/height as UploadPanel.
 * - Per-class colors (stable hash → HSL)
 * - Legend (top-right)
 */
export default function DetectPanel({
  imageURL,
  detections,
  allDetections = [],
  meta,
  disp,
  imageName,
  lineWidth = 2,
}) {
  const canvasRef = useRef(null);
  const [showLabels, setShowLabels] = useState(true);
  // legend now rendered as DOM panel on the right

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
  const { classList, colorOf, counts } = useMemo(() => {
    const seen = new Map(); // key -> {name, color}
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

    // counts per class for filtered and all
    const f = new Map();
    const r = new Map();
    for (const d of allDetections || []) {
      const key = d.class != null ? String(d.class) : d.class_id != null ? String(d.class_id) : "obj";
      r.set(key, (r.get(key) || 0) + 1);
      if (!seen.has(key)) { seen.set(key, { name: key, color: colorOfKey(key) }); order.push(key); }
    }
    for (const d of detections || []) {
      const key = d.class != null ? String(d.class) : d.class_id != null ? String(d.class_id) : "obj";
      f.set(key, (f.get(key) || 0) + 1);
    }

    // stable order: by raw count desc, then key
    order.sort((a, b) => (r.get(b) || 0) - (r.get(a) || 0) || String(a).localeCompare(String(b)));

    const colorOf = (key) =>
      (seen.get(String(key)) || { color: colorOfKey(String(key)) }).color;

    return { classList: order.map((k) => ({ key: k, ...seen.get(k) })), colorOf, counts: { f, r } };
  }, [detections, allDetections]);

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
      // Letterboxed draw preserving aspect ratio.
      // Use backend meta dimensions when available, since detections are produced in that space.
      // Fallback to decoded image dimensions.
      const srcW = (meta?.image_width) || img.naturalWidth;
      const srcH = (meta?.image_height) || img.naturalHeight;
      const scale = Math.min(dispW / srcW, dispH / srcH);
      const drawW = srcW * scale;
      const drawH = srcH * scale;
      const offX = (dispW - drawW) / 2;
      const offY = (dispH - drawH) / 2;
      // background
      const cssBg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#f3f4f6';
      ctx.fillStyle = cssBg;
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

      // legend moved to DOM; no canvas legend drawing
    };
    img.src = imageURL;
  }, [imageURL, detections, meta, disp, showLabels, lineWidth, classList, colorOf]);

  return (
    <div className="panel">
      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      {!imageURL && (
        <div className="empty-hint" aria-live="polite">Load an image to see detections</div>
      )}
      {imageURL && (
        <div className="legend-panel" style={{ right: 10, top: 10 }}>
          <div className="legend-head">
            <div className="legend-title">Legend</div>
          </div>
          <div className="legend-items">
            {classList.map((it) => (
              <div key={it.key} className="legend-item">
                <span className="legend-swatch" style={{ background: it.color.chip }} />
                <span className="legend-name">{it.name}</span>
                <span className="legend-count">
                  {(counts?.f?.get(it.key) || 0)} / {(counts?.r?.get(it.key) || 0)}
                </span>
              </div>
            ))}
          </div>
          <div className="legend-meta">
            <span className="legend-badge">Total: {(counts?.f ? Array.from(counts.f.values()).reduce((a,b)=>a+b,0) : (detections?.length||0))} / {(counts?.r ? Array.from(counts.r.values()).reduce((a,b)=>a+b,0) : (allDetections?.length||0))}</span>
            {meta?.image_width && meta?.image_height && (
              <span className="legend-badge">Source: {meta.image_width}×{meta.image_height}</span>
            )}
          </div>
          <div className="legend-footer">
            <div className="legend-actions">
              <button
                className="icon-btn"
                type="button"
                onClick={downloadPredImage}
                title="Download annotated image (.png)"
                aria-label="Download annotated image"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="3" width="18" height="14" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <path d="M21 17l-5-5-4 4-2-2-5 5"></path>
                </svg>
              </button>
              <button
                className="icon-btn"
                type="button"
                onClick={downloadLabelsTxt}
                title="Download labels (.txt)"
                aria-label="Download labels"
                disabled={!(detections && detections.length)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <path d="M14 2v6h6"></path>
                  <path d="M16 13H8"></path>
                  <path d="M16 17H8"></path>
                </svg>
              </button>
            </div>
            <label className="legend-check" title="Toggle labels on boxes">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                aria-label="Toggle labels"
              />
              <span>Labels</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
