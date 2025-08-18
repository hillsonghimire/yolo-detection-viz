import { useRef, useState } from "react";
import ObbCanvas from "./components/ObbCanvas.jsx";
import { detectBasic } from "./lib/api.js";

export default function App() {
  const [file, setFile] = useState(null);
  const [imgEl, setImgEl] = useState(null);
  const [detections, setDetections] = useState([]);
  const [meta, setMeta] = useState(null);
  const [conf, setConf] = useState(0.25);
  const inputRef = useRef(null);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    // preview
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
  };

  const run = async () => {
    if (!file) return;
    setDetections([]);
    setMeta(null);
    const data = await detectBasic({ file, confidence: conf });
    // backend now returns polygon-only detections
    setDetections(data.detections || []);
    setMeta({ image_width: data.image_width, image_height: data.image_height });
  };

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto", fontFamily: "ui-sans-serif, system-ui" }}>
      <h2>YOLO OBB Detection</h2>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input ref={inputRef} type="file" accept="image/*" onChange={onPick} />
        <button onClick={run} disabled={!file}>Start Processing</button>
        <div>Selected: {file?.name || "—"}</div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div>Confidence: {conf.toFixed(2)}</div>
        <input
          type="range"
          min="0.01"
          max="0.99"
          step="0.01"
          value={conf}
          onChange={(e) => setConf(parseFloat(e.target.value))}
          style={{ width: 320 }}
        />
        <button onClick={run} disabled={!file} style={{ marginLeft: 8 }}>
          Re-run with confidence
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {imgEl ? (
          <ObbCanvas image={imgEl} detections={detections} meta={meta} width={1000} />
        ) : (
          <div style={{ color: "#666" }}>Pick an image to preview.</div>
        )}
      </div>
    </div>
  );
}
