import { useEffect, useRef, useState } from "react";

const ZOOM_WHEEL_STEP = 0.18;

export default function ZoomableImage({ src, placeholder = "", frameWidth = 420, frameHeight = 315, downloads = [] }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPtRef = useRef({ x: 0, y: 0 });

  const baseWidth = Math.max(frameWidth || 420, 200);
  const baseHeight = Math.max(frameHeight || Math.round(baseWidth * 0.75), 200);
  const aspect = baseHeight / baseWidth;

  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = src;
  }, [src]);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [img]);

  const render = () => {
    const wrap = wrapRef.current;
    const cvs = canvasRef.current;
    if (!wrap || !cvs) return;

    const dpr = window.devicePixelRatio || 1;
    const availableWidth = Math.floor(wrap.clientWidth || baseWidth);
    const viewW = Math.round(Math.max(200, Math.min(baseWidth, availableWidth)));
    const viewH = Math.round(viewW * aspect);

    cvs.style.width = `${viewW}px`;
    cvs.style.height = `${viewH}px`;
    cvs.width = Math.round(viewW * dpr);
    cvs.height = Math.round(viewH * dpr);

    const ctx = cvs.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    if (!img) return;

    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const baseScale = Math.min(viewW / iw, viewH / ih, 1);
    const drawW = iw * baseScale * zoom;
    const drawH = ih * baseScale * zoom;
    const cx = viewW / 2 + offset.x;
    const cy = viewH / 2 + offset.y;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  };

  useEffect(() => {
    render();
  }, [img, zoom, offset, frameWidth, frameHeight]);

  useEffect(() => {
    if (!img) return;
    const onResize = () => render();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [img, frameWidth, frameHeight]);

  const onWheel = (e) => {
    if (!img) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    setZoom((z) => Math.min(10, Math.max(1, z + dir * ZOOM_WHEEL_STEP)));
  };

  const handleDownload = (dl) => {
    if (!dl || !dl.href) return;
    const link = document.createElement("a");
    link.href = dl.href;
    if (dl.downloadName) {
      link.download = dl.downloadName;
    } else {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const fullscreenIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="14" y1="10" x2="21" y2="3"></line>
      <polyline points="9 21 3 21 3 15"></polyline>
      <line x1="10" y1="14" x2="3" y2="21"></line>
    </svg>
  );

  const onDown = (e) => {
    if (!img) return;
    isPanningRef.current = true;
    lastPtRef.current = { x: e.clientX, y: e.clientY };
  };

  const onMove = (e) => {
    if (!img || !isPanningRef.current) return;
    const dx = e.clientX - lastPtRef.current.x;
    const dy = e.clientY - lastPtRef.current.y;
    lastPtRef.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  };

  const onUp = () => {
    isPanningRef.current = false;
  };

  const openFullRes = async () => {
    if (!src) {
      return;
    }

    const viewer = window.open("about:blank", "_blank");
    if (!viewer) {
      window.open(src, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      viewer.opener = null;
    } catch {}

    const render = (href, revoke = false) => {
      try {
        viewer.document.open();
        viewer.document.write(`<!doctype html>
<title>Full Resolution</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html,body{margin:0;background:#0b0b0b;display:flex;justify-content:center;align-items:center;height:100%;}
  img{max-width:100%;height:auto;display:block;background:#111;}
</style>
<body>
  <img src="${href}" alt="Full resolution preview" />
</body>`);
        viewer.document.close();
      } catch {
        viewer.location.href = href;
      }

      if (revoke && href.startsWith("blob:")) {
        const cleanup = () => {
          URL.revokeObjectURL(href);
          viewer.removeEventListener("beforeunload", cleanup);
        };
        viewer.addEventListener("beforeunload", cleanup);
        setTimeout(cleanup, 60000);
      }
    };

    if (src.startsWith("data:") || src.startsWith("blob:")) {
      render(src, false);
      return;
    }

    // show loading placeholder while fetching
    try {
      viewer.document.open();
      viewer.document.write("<!doctype html><title>Loading…</title><body style='margin:0;background:#0b0b0b;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100%;'>Loading full resolution…</body>");
      viewer.document.close();
    } catch {}

    try {
      const resp = await fetch(src, { mode: "cors", credentials: "include" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      render(blobUrl, true);
    } catch (err) {
      try {
        viewer.location.href = src;
      } catch {
        window.open(src, "_blank", "noopener,noreferrer");
      }
    }
  };

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap zoomable-wrap"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: baseWidth,
        minHeight: baseHeight,
      }}
    >
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        style={{
          borderRadius: 6,
          background: "transparent",
          width: "100%",
          display: "block",
          cursor: img ? "grab" : "default",
        }}
      />
      {!img && placeholder && (
        <div className="zoom-placeholder small">{placeholder}</div>
      )}
      {img && (
        <>
          <div className="map-controls" style={{ left: 12, top: 12 }}>
            <button
              className="icon-btn"
              type="button"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(10, z + 0.15))}
            >
              +
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(1, z - 0.15))}
            >
              -
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Reset view"
              aria-label="Reset view"
              onClick={() => {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              ⟲
            </button>
          </div>
          <div className="map-downloads" style={{ right: 12, top: 12 }}>
            {downloads.map((dl) => (
              <button
                key={dl.href}
                className="icon-btn"
                type="button"
                title={dl.label}
                aria-label={dl.label}
                onClick={() => handleDownload(dl)}
              >
                {dl.icon}
              </button>
            ))}
            <button
              className="icon-btn"
              type="button"
              title="Open full resolution"
              aria-label="Open full resolution"
              onClick={openFullRes}
            >
              {fullscreenIcon}
            </button>
          </div>
          <div className="zoom-meter">{zoom.toFixed(2)}x</div>
        </>
      )}
    </div>
  );
}
