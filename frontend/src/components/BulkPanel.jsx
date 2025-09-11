import { useEffect, useMemo, useRef, useState } from "react";
import { submitBulk, listBulkJobs, listJobs, downloadUrl } from "../lib/api.js";

export default function BulkPanel({ model, onExit }) {
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkJobs, setBulkJobs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [conf, setConf] = useState(0.25);
  const inputRef = useRef(null);

  const onPick = (fileList) => {
    const arr = Array.from(fileList || []);
    // validate and de-dup by name+size
    const sig = new Set(files.map(f => `${f.name}|${f.size}`));
    const merged = [...files];
    let skipped = 0;
    for (const f of arr) {
      if (!f || !('size' in f) || f.size <= 0 || (f.type && !f.type.startsWith('image/'))) { skipped++; continue; }
      const k = `${f.name}|${f.size}`;
      if (!sig.has(k)) { merged.push(f); sig.add(k); }
    }
    if (skipped) setMessage(`${skipped} file(s) skipped (empty or not an image).`);
    setFiles(merged);
  };

  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  const onDragEnter = (e) => { prevent(e); setDrag(true); };
  const onDragLeave = (e) => { prevent(e); setDrag(false); };
  const onDrop = async (e) => {
    prevent(e); setDrag(false);
    const dt = e.dataTransfer;
    if (dt?.files && dt.files.length) { onPick(dt.files); return; }
    const uriList = dt?.getData('text/uri-list') || dt?.getData('text/plain');
    if (uriList) {
      const urls = uriList.split(/\r?\n/).filter(Boolean);
      const fetched = [];
      for (const url of urls) {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          if (blob.size > 0 && (!blob.type || blob.type.startsWith('image/'))) {
            const name = url.split('/').pop() || 'image.jpg';
            fetched.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
          }
        } catch {}
      }
      if (fetched.length) onPick(fetched);
    }
  };

  const refresh = async () => {
    try {
      const [bj, j] = await Promise.all([listBulkJobs(), listJobs()]);
      setBulkJobs(Array.isArray(bj) ? bj : []);
      setJobs(Array.isArray(j) ? j : []);
    } catch (e) {
      setMessage(String(e.message || e));
    }
  };

  useEffect(() => { refresh(); }, []);

  // Auto-refresh job lists every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const onSubmit = async () => {
    if (!files.length) { setMessage('Please add one or more image files.'); return; }
    setSubmitting(true);
    setMessage("");
    try {
      await submitBulk({ files, model, confidence: conf });
      setFiles([]);
      await refresh();
      setMessage("Bulk job submitted.");
    } catch (e) {
      setMessage(String(e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const recentJobs = useMemo(() => jobs.slice(0, 20), [jobs]);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Bulk Processing</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" type="button" onClick={() => inputRef.current?.click()} disabled={submitting} title="Select image files to upload">Select Files</button>
          <button className="btn" type="button" onClick={onExit}>Exit</button>
        </div>
      </div>

      <div className={"panel" + (drag ? " dragover" : "")}
        onDragEnter={onDragEnter} onDragOver={prevent} onDragLeave={onDragLeave} onDrop={onDrop}
        style={{ minHeight: 180 }}
      >
        <div className="drop-hint"></div>
        <div style={{ textAlign: "center", padding: 20, width: "100%" }}>
          <p style={{ marginTop: 0, color: 'var(--fg)' }}>Drop images here or select files</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => inputRef.current?.click()} disabled={submitting}>Choose Files</button>
            <button className="btn" type="button" onClick={onSubmit} disabled={!files.length || submitting}>
              {submitting ? "Submitting..." : `Submit Job (${files.length})`}
            </button>
          </div>
          <div className="hslider" style={{ maxWidth: 520, margin: "10px auto 0" }}>
            <div className="hslider-label">Confidence</div>
            <input className="hslider modern-hslider" type="range" min="0" max="1" step="0.01"
              value={conf} onChange={(e) => setConf(parseFloat(e.target.value))}
              style={{ ["--pct"]: `${Math.round(conf * 100)}%` }}
            />
            <div className="hslider-value">{Math.round(conf * 100)}%</div>
          </div>
          <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onPick(e.target.files)} />
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ marginBottom: 6 }}>{files.length} files selected</div>
          <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 8, background: "#fff" }}>
            {files.map((f, i) => (
              <div key={i} className="small" style={{ color: 'var(--fg)' }}>{f.name}</div>
            ))}
          </div>
        </div>
      )}

      {message && <div className="small" style={{ color: "#b91c1c", marginTop: 8 }}>{message}</div>}

      <div className="card" style={{ marginTop: 14 }}>
        <h4 style={{ marginTop: 0 }}>Bulk Jobs</h4>
        <div className="small" style={{ marginBottom: 8 }}>Recent bulk submissions and status</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: 'var(--fg)' }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>ID</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Status</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Created</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Downloads</th>
              </tr>
            </thead>
            <tbody>
              {bulkJobs.map((b) => {
                const idShort = String(b.id).slice(0, 8);
                const excelName = (b.excel_file || "").split("/").pop();
                return (
                  <tr key={b.id} className="small" style={{ color: 'var(--fg)' }}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{idShort}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{b.status}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{new Date(b.created_at).toLocaleString()}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                      {excelName ? (
                        <a className="btn" style={{ padding: "6px 10px" }} href={downloadUrl('excel', excelName)}>Excel</a>
                      ) : (
                        <span className="small" style={{ color: 'var(--muted)' }}>Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn ghost" type="button" onClick={refresh}>Refresh</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h4 style={{ marginTop: 0 }}>Recent Jobs</h4>
        <div className="small" style={{ marginBottom: 8 }}>Latest detection jobs (links to outputs when ready)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: 'var(--fg)' }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Image</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Status</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Progress</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Detections</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Labels</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Annotated</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((j) => {
                const imgName = (j.image || "").split("/").pop();
                const labName = (j.labels_file || "").split("/").pop();
                const annName = (j.annotated_image || "").split("/").pop();
                return (
                  <tr key={j.id} className="small" style={{ color: 'var(--fg)' }}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{imgName || j.id}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{j.status}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{j.progress ?? 0}%</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{j.detection_count ?? 0}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                      {labName ? <a className="btn ghost" style={{ padding: "6px 10px" }} href={downloadUrl('labels', labName)}>Labels</a> : <span className="small" style={{ color: 'var(--muted)' }}>-</span>}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                      {annName ? <a className="btn ghost" style={{ padding: "6px 10px" }} href={downloadUrl('image', annName)}>Image</a> : <span className="small" style={{ color: 'var(--muted)' }}>-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost" type="button" onClick={refresh}>Refresh</button>
          <button className="btn ghost" type="button" onClick={() => {
            const names = recentJobs.map(j => (j.labels_file || "").split("/").pop()).filter(Boolean);
            names.forEach((n, i) => setTimeout(() => { const a=document.createElement('a'); a.href=downloadUrl('labels', n); a.download=n; document.body.appendChild(a); a.click(); a.remove(); }, i*150));
          }}>Download All Labels</button>
          <button className="btn ghost" type="button" onClick={() => {
            const names = recentJobs.map(j => (j.annotated_image || "").split("/").pop()).filter(Boolean);
            names.forEach((n, i) => setTimeout(() => { const a=document.createElement('a'); a.href=downloadUrl('image', n); a.download=n; document.body.appendChild(a); a.click(); a.remove(); }, i*150));
          }}>Download All Images</button>
        </div>
      </div>
    </div>
  );
}
