import { useEffect, useMemo, useRef, useState } from "react";

const WHEEL_STEP = 0.18;

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
  conf,
  onChangeConf,
  model,
  lineWidth = 2,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [showLabels, setShowLabels] = useState(false);
  // legend now rendered as DOM panel on the right
  const legendRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drawSizeRef = useRef({ w: 0, h: 0 });
  const isPanningRef = useRef(false);
  const lastPtRef = useRef({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const imageDimsRef = useRef({ w: 0, h: 0 });
  const wheelTimeoutRef = useRef(null);
  const fullscreenIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="14" y1="10" x2="21" y2="3"></line>
      <polyline points="9 21 3 21 3 15"></polyline>
      <line x1="10" y1="14" x2="3" y2="21"></line>
    </svg>
  );

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

  const frameWidth = Math.max(200, Math.round(disp?.width || 420));
  const frameHeight = Math.max(180, Math.round(disp?.height || Math.round(frameWidth * 0.75)));

  const getSourceDims = async () => {
    if (meta?.image_width && meta?.image_height) {
      return { w: meta.image_width, h: meta.image_height };
    }
    if (imageDimsRef.current.w && imageDimsRef.current.h) {
      return imageDimsRef.current;
    }
    const probe = new Image();
    const dims = await new Promise((resolve) => {
      probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => resolve({ w: disp?.width || 0, h: disp?.height || 0 });
      probe.src = imageURL;
    });
    imageDimsRef.current = dims;
    return dims;
  };

  const buildAnnotatedCanvas = () => {
    const baseImg = imageRef.current;
    const dims = imageDimsRef.current;
    if (!baseImg || !dims.w || !dims.h) return null;

    const out = document.createElement("canvas");
    out.width = Math.round(dims.w);
    out.height = Math.round(dims.h);
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(baseImg, 0, 0, out.width, out.height);
    ctx.lineWidth = lineWidth;
    const fontSize = Math.max(14, Math.round(out.width / 80));
    ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
    ctx.textBaseline = "top";

    for (const d of detections || []) {
      const p = d.poly || d.polygon || d.xyxyxyxy || d.points;
      if (!Array.isArray(p) || p.length !== 8) continue;

      const key =
        d.class != null ? String(d.class) :
        d.class_id != null ? String(d.class_id) :
        "obj";
      const col = colorOf(key);

      const pts = [
        [p[0], p[1]],
        [p[2], p[3]],
        [p[4], p[5]],
        [p[6], p[7]],
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
        const keyStr = d.class != null ? String(d.class) : d.class_id != null ? String(d.class_id) : "obj";
        const name = displayName(keyStr);
        const confPct = Math.round(((d.confidence ?? 0) * 1000)) / 10;
        const label = `${name} ${confPct}%`;

        const x = Math.min(...pts.map((pt) => pt[0]));
        const y = Math.min(...pts.map((pt) => pt[1]));
        const padX = Math.max(6, Math.round(fontSize * 0.35));
        const padY = Math.max(4, Math.round(fontSize * 0.25));
        const tw = ctx.measureText(label).width;
        const th = fontSize + 2 * padY;

        ctx.fillStyle = col.chip;
        ctx.fillRect(x, y - th - 2, tw + 2 * padX, th);
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y - th - 2, tw + 2 * padX, th);

        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + padX, y - th - 2 + padY);
      }
    }

    return out;
  };

  const downloadPredImage = () => {
    const out = buildAnnotatedCanvas();
    if (!out) return;
    const name = `${imgNameBase}_pred.png`;
    const triggerDownload = (href) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    if (out.toBlob) {
      out.toBlob((blob) => {
        if (!blob) return;
        const blobUrl = URL.createObjectURL(blob);
        triggerDownload(blobUrl);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      });
    } else {
      triggerDownload(out.toDataURL("image/png"));
    }
  };

  const openFullRes = () => {
    const out = buildAnnotatedCanvas();
    if (out) {
      const dataUrl = out.toDataURL("image/png");
      const newWin = window.open("", "_blank");
      if (newWin && newWin.document) {
        newWin.document.title = `${imgNameBase}_pred`;
        newWin.document.body.style.margin = "0";
        newWin.document.body.innerHTML = `<img src="${dataUrl}" alt="Annotated" style="width:100%;height:auto;display:block;background:#111" />`;
      } else {
        window.open(dataUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (imageURL) {
      window.open(imageURL, "_blank", "noopener,noreferrer");
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
  const displayName = (key) => {
    const k = String(key);
    const num = Number.parseInt(k, 10);
    if (model === 'spike') {
      if (num === 0) return 'spike';
    } else if (model === 'spikelet') {
      if (num === 0) return 'spikelet';
    } else if (model === 'fdk') {
      if (num === 1) return 'healthy';
      if (num === 0) return 'infected';
    } else if (model === 'fhb') {
      // Corrected: FHB labels were flipped
      if (num === 0) return 'healthy';
      if (num === 1) return 'infected';
    }
    return k;
  };

  // Map class key to the color/display key for legend alignment (no flips)
  const colorKeyForModel = (k) => String(k);

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
    const colorKey = (k) => String(k);
    const legendLabel = (k) => {
      if (model === 'fdk') {
        const s = String(k);
        if (s === '0') return 'infected';
        if (s === '1') return 'healthy';
        return s;
      }
      return displayName(k);
    };

    (detections || []).forEach((d) => {
      const key =
        d.class != null ? String(d.class) :
        d.class_id != null ? String(d.class_id) :
        "obj";
      if (!seen.has(key)) {
        seen.set(key, { name: legendLabel(key), color: colorOfKey(colorKey(key)) });
        order.push(key);
      }
    });

    // counts per class for filtered and all
    const f = new Map();
    const r = new Map();
    for (const d of allDetections || []) {
      const key = d.class != null ? String(d.class) : d.class_id != null ? String(d.class_id) : "obj";
      r.set(key, (r.get(key) || 0) + 1);
      if (!seen.has(key)) { seen.set(key, { name: legendLabel(key), color: colorOfKey(colorKey(key)) }); order.push(key); }
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
  }, [detections, allDetections, model]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!imageURL) {
      imageRef.current = null;
      imageDimsRef.current = { w: 0, h: 0 };
      return;
    }
    if (!cvs) return;

    const pixelRatio = disp?.dpr || window.devicePixelRatio || 1;
    const ctx = cvs.getContext("2d");

    const img = new Image();
    img.onload = () => {
      const srcW = meta?.image_width || img.naturalWidth;
      const srcH = meta?.image_height || img.naturalHeight;
      if (!srcW || !srcH) return;
      imageRef.current = img;
      imageDimsRef.current = { w: srcW, h: srcH };

      const scale = Math.min(frameWidth / srcW, frameHeight / srcH, 1);
      const drawW = Math.max(1, Math.round(srcW * scale));
      const drawH = Math.max(1, Math.round(srcH * scale));
      const offsetX = Math.round((frameWidth - drawW) / 2);
      const offsetY = Math.round((frameHeight - drawH) / 2);

      cvs.width = Math.round(frameWidth * pixelRatio);
      cvs.height = Math.round(frameHeight * pixelRatio);
      cvs.style.width = `${frameWidth}px`;
      cvs.style.height = `${frameHeight}px`;

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, frameWidth, frameHeight);

      drawSizeRef.current = { w: frameWidth, h: frameHeight };
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(zoom, zoom);
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      ctx.lineWidth = lineWidth;
      const fontSize = 12;
      ctx.font = `${fontSize}px ui-sans-serif, system-ui`;
      ctx.textBaseline = "top";

      for (const d of detections || []) {
        const p = d.poly || d.polygon || d.xyxyxyxy || d.points;
        if (!Array.isArray(p) || p.length !== 8) continue;

        const key =
          d.class != null ? String(d.class) :
          d.class_id != null ? String(d.class_id) :
          "obj";
        const col = colorOf(key);

        const pts = [
          [p[0] * scale + offsetX, p[1] * scale + offsetY],
          [p[2] * scale + offsetX, p[3] * scale + offsetY],
          [p[4] * scale + offsetX, p[5] * scale + offsetY],
          [p[6] * scale + offsetX, p[7] * scale + offsetY],
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
          const key = d.class != null ? String(d.class) : d.class_id != null ? String(d.class_id) : 'obj';
          const name = displayName(key);
          const confPct = Math.round(((d.confidence ?? 0) * 1000)) / 10;
          const label = `${name} ${confPct}%`;

          const x = Math.min(...pts.map((pt) => pt[0]));
          const y = Math.min(...pts.map((pt) => pt[1]));
          const padX = 5;
          const padY = 3;
          const tw = ctx.measureText(label).width;
          const th = fontSize + 2 * padY;

          ctx.fillStyle = col.chip;
          ctx.fillRect(x, y - th - 2, tw + 2 * padX, th);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y - th - 2, tw + 2 * padX, th);

          ctx.fillStyle = "#fff";
          ctx.fillText(label, x + padX, y - th - 2 + padY);
        }
      }

      ctx.restore();
    };
    img.src = imageURL;
  }, [imageURL, detections, meta, frameWidth, frameHeight, disp, showLabels, lineWidth, colorOf, zoom, offset]);

  // legend size not needed

  // Clamp pan when zoom changes
  useEffect(() => {
    const { w, h } = drawSizeRef.current;
    if (!w || !h) return;
    setOffset((prev) => {
      if (zoom <= 1) return { x: 0, y: 0 };
      const minX = -(w * (zoom - 1));
      const minY = -(h * (zoom - 1));
      const nx = Math.max(minX, Math.min(0, prev.x));
      const ny = Math.max(minY, Math.min(0, prev.y));
      return (nx !== prev.x || ny !== prev.y) ? { x: nx, y: ny } : prev;
    });
  }, [zoom]);

  // Mouse drag to pan
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const onDown = (e) => {
      if (zoom <= 1) return;
      isPanningRef.current = true;
      lastPtRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - lastPtRef.current.x;
      const dy = e.clientY - lastPtRef.current.y;
      lastPtRef.current = { x: e.clientX, y: e.clientY };
      setOffset((prev) => {
        const { w, h } = drawSizeRef.current;
        if (!w || !h) return prev;
        const minX = -(w * (zoom - 1));
        const minY = -(h * (zoom - 1));
        const nx = Math.max(minX, Math.min(0, prev.x + dx));
        const ny = Math.max(minY, Math.min(0, prev.y + dy));
        return { x: nx, y: ny };
      });
    };
    const onUp = () => { isPanningRef.current = false; };
    cvs.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      cvs.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom]);

  // Wheel to zoom (like kernel measurement)
  useEffect(() => {
    const el = containerRef.current || canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY > 0 ? -1 : 1;
      setZoom((z) => Math.min(5, Math.max(1, z + dir * WHEEL_STEP)));
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
      wheelTimeoutRef.current = setTimeout(() => {
        wheelTimeoutRef.current = null;
      }, 200);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    };
  }, []);

  return (
    <div className="panel">
      {imageURL ? (
        <div
          className="canvas-wrap"
          ref={containerRef}
          style={{ width: frameWidth, height: frameHeight }}
        >
          <canvas ref={canvasRef} />
          <div className="map-controls" style={{ left: 12, top: 12 }}>
            <button className="icon-btn" type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(10, z + 0.15))}>+
            </button>
            <button className="icon-btn" type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z - 0.15))}>-
            </button>
            <button className="icon-btn" type="button" title="Reset view" aria-label="Reset view" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>⟲</button>
          </div>
          <div className="map-downloads" style={{ right: 12, top: 12 }}>
            <button
              className="icon-btn"
              type="button"
              onClick={downloadPredImage}
              title="Download annotated image"
              aria-label="Download annotated image"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="18" height="14" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <path d="M21 17l-5-5-4 4-2-2-5 5"></path>
              </svg>
            </button>
            <button className="icon-btn" type="button" title="Open full resolution" aria-label="Open full resolution" onClick={openFullRes}>{fullscreenIcon}</button>
          </div>
          <div className="zoom-meter">{zoom.toFixed(2)}x</div>
        </div>
      ) : (
        <div
          className="detect-placeholder"
          style={{
            width: frameWidth,
            height: frameHeight,
          }}
        >
          <div className="placeholder-text">Load an image to see detections</div>
        </div>
      )}
      {imageURL && (
        <div ref={legendRef} className="legend-panel" style={{ right: 10, top: 10 }}>
          <div className="legend-head">
            <div className="legend-title">Legend</div>
          </div>
          <div className="legend-items">
            {classList.map((it) => {
              const keyStr = String(it.key);
              const name = model === 'fdk' ? (keyStr === '0' ? 'infected' : (keyStr === '1' ? 'healthy' : keyStr)) : it.name;
              const shown = (counts?.f?.get(it.key) || 0);
              const total = (counts?.r?.get(it.key) || 0);
              return (
                <div key={it.key} className="legend-item">
                  <span className="legend-swatch" style={{ background: it.color.chip }} />
                  <span className="legend-name">{name}</span>
                  <span className="legend-count">{shown} / {total}</span>
                </div>
              );
            })}
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
              <span>Toggle Labels</span>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                aria-label="Toggle labels"
              />
            </label>
          </div>
        </div>
      )}
      
    </div>
  );
}
