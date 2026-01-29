import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { submitBulk, listBulkJobs, listJobs, downloadUrl, downloadMeasure } from "../lib/api.js";

export default function BulkPanel({ model, onExit, kernelParams, setKernelParams, stomataParams, setStomataParams, isAuthenticated, onRequireLogin }) {
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkJobs, setBulkJobs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [conf, setConf] = useState(0.25);
  const inputRef = useRef(null);
  const allowLabelDownloads = !["0", "false", "no"].includes(
    String(import.meta.env.VITE_DOWNLOAD_LABELS ?? "true").toLowerCase(),
  );
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const kp = kernelParams || { sidemm: 40, allowedIds: "425,100,201,310", useSam: false, samCheckpoint: "", samModelType: "vit_b" };
  const sp = stomataParams || { umPerPx: 0.3448275862, iou: 0.7 };
  const applyKernelUpdate = (updater) => {
    if (typeof setKernelParams === "function") {
      setKernelParams((prev) => {
        const base = prev || { sidemm: 40, allowedIds: "425,100,201,310", useSam: false, samCheckpoint: "", samModelType: "vit_b" };
        return updater(base);
      });
    }
  };
  const applyStomataUpdate = (updater) => {
    if (typeof setStomataParams === "function") {
      setStomataParams((prev) => {
        const base = prev || { umPerPx: 0.3448275862, iou: 0.7 };
        return updater(base);
      });
    }
  };

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

  const triggerFileDialog = () => {
    if (submitting) return;
    inputRef.current?.click();
  };

  const handleChooseClick = () => {
    if (submitting) return;
    if (disclaimerAccepted) {
      triggerFileDialog();
    } else {
      setShowDisclaimer(true);
    }
  };

  const handleAcceptDisclaimer = () => {
    if (submitting) return;
    setDisclaimerAccepted(true);
    setShowDisclaimer(false);
    // Defer launching picker until modal unmounts to avoid overlay flashes
    setTimeout(() => {
      triggerFileDialog();
    }, 0);
  };

  const handleDeclineDisclaimer = () => {
    setShowDisclaimer(false);
    setDisclaimerAccepted(false);
  };

  const disclaimerText = "Please do not upload or include any sensitive, confidential, or personal information in your submission. Ensure that any data you provide is appropriate and does not contain private credentials, proprietary content, or identifying details.";
  const canPortal = typeof document !== "undefined";

  const refresh = async () => {
    try {
      if (!isAuthenticated) return;
      const [bj, j] = await Promise.all([listBulkJobs(), listJobs()]);
      setBulkJobs(Array.isArray(bj) ? bj : []);
      setJobs(Array.isArray(j) ? j : []);
    } catch (e) {
      setMessage(String(e.message || e));
    }
  };

  useEffect(() => { refresh(); }, [isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated) {
      setBulkJobs([]);
      setJobs([]);
    }
  }, [isAuthenticated]);

  // Auto-refresh job lists every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  const onSubmit = async () => {
    if (!isAuthenticated) {
      setMessage("Please login to continue.");
      if (typeof window !== "undefined") {
        window.alert("Please login to continue.");
      }
      if (typeof onRequireLogin === "function") onRequireLogin();
      return;
    }
    if (!files.length) { setMessage('Please add one or more image files.'); return; }
    setSubmitting(true);
    setMessage("");
    try {
      const payload = { files, model, confidence: conf };
      if ((model || "").toLowerCase() === "kernel") {
        payload.kernelParams = kp;
      }
      if ((model || "").toLowerCase() === "stomata") {
        payload.stomataParams = sp;
      }
      await submitBulk(payload);
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
  const extractMeasurementAssets = (job) => {
    let overlayName = null;
    let csvName = null;
    let data = null;
    try {
      data = typeof job.result === "string" ? JSON.parse(job.result) : job.result;
    } catch {}
    if (data && typeof data === "object") {
      if (typeof data.measurement_overlay === "string" && data.measurement_overlay) {
        overlayName = data.measurement_overlay.split("/").pop();
      }
      if (typeof data.measurement_csv === "string" && data.measurement_csv) {
        csvName = data.measurement_csv.split("/").pop();
      }
    }
    return {
      overlayName,
      csvName,
      overlayHref: overlayName ? downloadMeasure('image', overlayName) : null,
      csvHref: csvName ? downloadMeasure('csv', csvName) : null,
    };
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Bulk Processing</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* <button className="btn" type="button" onClick={() => inputRef.current?.click()} disabled={submitting} title="Select image files to upload">Select Files</button> */}
          {/* <button className="btn" type="button" onClick={onExit}>Exit</button> */}
        </div>
      </div>
      {!isAuthenticated && (
        <p className="small" style={{ color: "var(--muted)", marginTop: 0 }}>
          Log in to start bulk processing. You can still explore the interface and prepare files.
        </p>
      )}

      <div className={"panel" + (drag ? " dragover" : "")}
        onDragEnter={onDragEnter} onDragOver={prevent} onDragLeave={onDragLeave} onDrop={onDrop}
        style={{ minHeight: 180, overflow: "visible" }}
      >
        <div className="drop-hint"></div>
        <div style={{ textAlign: "center", padding: 20, width: "100%" }}>
          <p style={{ marginTop: 0, color: 'var(--fg)' }}>Drop images here or select files</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <div className="disclaimer-wrap">
              <button className="btn" type="button" onClick={handleChooseClick} disabled={submitting}>
                Choose Files
              </button>
              {showDisclaimer && !submitting && canPortal && createPortal(
                <div className="disclaimer-overlay" role="alertdialog" aria-modal="true">
                  <div className="disclaimer-dialog">
                    <p className="disclaimer-text">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 2a1 1 0 0 1 .87.49l10 17a1 1 0 0 1-.87 1.51H2a1 1 0 0 1-.87-1.51l10-17A1 1 0 0 1 12 2zm0 3.54L4.62 19h14.76L12 5.54zM11 10h2v5h-2zm0 6h2v2h-2z"/>
                      </svg>
                      {disclaimerText}
                    </p>
                    <div className="disclaimer-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={handleAcceptDisclaimer}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn outline"
                        onClick={handleDeclineDisclaimer}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
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
          {(model || "").toLowerCase() === "kernel" && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
              <label className="small">Side (mm)</label>
              <input
                className="input"
                style={{ width: 90 }}
                type="number"
                min="0.1"
                step="0.1"
                value={kp.sidemm ?? 40}
                onChange={(e) => applyKernelUpdate((prev) => ({ ...prev, sidemm: parseFloat(e.target.value) || 0 }))}
              />
              <label className="small">ArUco IDs</label>
              <input
                className="input"
                style={{ width: 200 }}
                type="text"
                value={kp.allowedIds ?? ""}
                onChange={(e) => applyKernelUpdate((prev) => ({ ...prev, allowedIds: e.target.value }))}
                placeholder="425,100,201,310"
              />
              <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!kp.useSam}
                  onChange={(e) => applyKernelUpdate((prev) => ({ ...prev, useSam: e.target.checked }))}
                /> SAM
              </label>
              <input
                className="input"
                style={{ width: 220 }}
                type="text"
                disabled={!kp.useSam}
                value={kp.samCheckpoint ?? ""}
                onChange={(e) => applyKernelUpdate((prev) => ({ ...prev, samCheckpoint: e.target.value }))}
                placeholder="models/sam_vit_b_01ec64.pth"
              />
              <select
                className="select"
                value={kp.samModelType ?? "vit_b"}
                disabled={!kp.useSam}
                onChange={(e) => applyKernelUpdate((prev) => ({ ...prev, samModelType: e.target.value }))}
              >
                <option value="vit_b">vit_b</option>
                <option value="vit_l">vit_l</option>
                <option value="vit_h">vit_h</option>
              </select>
            </div>
          )}
          {(model || "").toLowerCase() === "stomata" && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
              <label className="small">um per pixel</label>
              <input
                className="input"
                style={{ width: 120 }}
                type="number"
                min="0.001"
                step="0.001"
                value={sp.umPerPx ?? 0.3448275862}
                onChange={(e) => applyStomataUpdate((prev) => ({ ...prev, umPerPx: parseFloat(e.target.value) || 0 }))}
              />
              <label className="small">IOU</label>
              <input
                className="input"
                style={{ width: 90 }}
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={sp.iou ?? 0.7}
                onChange={(e) => applyStomataUpdate((prev) => ({ ...prev, iou: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          )}
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
                {allowLabelDownloads && (
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Labels</th>
                )}
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>CSV</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Annotated</th>
              </tr>
            </thead>
            <tbody>
              {recentJobs.map((j) => {
                const imgName = (j.image || "").split("/").pop();
                const labName = (j.labels_file || "").split("/").pop();
                const annName = (j.annotated_image || "").split("/").pop();
                const { overlayHref, csvHref, overlayName, csvName } = extractMeasurementAssets(j);
                const labelsHref = labName ? downloadUrl('labels', labName) : null;
                const annotatedHref = overlayHref || (annName ? downloadUrl('image', annName) : null);
                const labelTitle = "Download labels (.txt)";
                const csvTitle = "Download measurement CSV";
                const annotatedTitle = overlayHref ? "Download measurement overlay" : "Download annotated image (.png)";
                return (
                  <tr key={j.id} className="small" style={{ color: 'var(--fg)' }}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{imgName || j.id}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{j.status}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{j.progress ?? 0}%</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{j.detection_count ?? 0}</td>
                    {allowLabelDownloads && (
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                        {labelsHref ? (
                          <a className="icon-btn" href={labelsHref} title={labelTitle} aria-label={labelTitle}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <path d="M14 2v6h6"></path>
                              <path d="M16 13H8"></path>
                              <path d="M16 17H8"></path>
                            </svg>
                          </a>
                        ) : (
                          <span className="small" style={{ color: 'var(--muted)' }}>-</span>
                        )}
                      </td>
                    )}
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                      {csvHref ? (
                        <a className="icon-btn" href={csvHref} title={csvTitle} aria-label={csvTitle}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <path d="M14 2v6h6"></path>
                            <path d="M16 13H8"></path>
                            <path d="M16 17H8"></path>
                          </svg>
                        </a>
                      ) : (
                        <span className="small" style={{ color: 'var(--muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                      {annotatedHref ? (
                        <a className="icon-btn" href={annotatedHref} title={annotatedTitle} aria-label={annotatedTitle}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="3" y="3" width="18" height="14" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <path d="M21 17l-5-5-4 4-2-2-5 5"></path>
                          </svg>
                        </a>
                      ) : (
                        <span className="small" style={{ color: 'var(--muted)' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost" type="button" onClick={refresh}>Refresh</button>
          {allowLabelDownloads && (
            <button className="btn ghost" type="button" onClick={() => {
              const downloads = recentJobs
                .map((job) => {
                  const lab = (job.labels_file || "").split("/").pop();
                  if (lab) return { href: downloadUrl('labels', lab), name: lab };
                  return null;
                })
                .filter(Boolean);
              downloads.forEach((item, idx) => {
                setTimeout(() => {
                  const a = document.createElement('a');
                  a.href = item.href;
                  if (item.name) a.download = item.name;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }, idx * 150);
              });
            }}>Download All Labels</button>
          )}
          <button className="btn ghost" type="button" onClick={() => {
            const downloads = recentJobs
              .map((job) => {
                const { overlayHref, overlayName } = extractMeasurementAssets(job);
                if (overlayHref && overlayName) return { href: overlayHref, name: overlayName };
                const ann = (job.annotated_image || "").split("/").pop();
                if (ann) return { href: downloadUrl('image', ann), name: ann };
                return null;
              })
              .filter(Boolean);
            downloads.forEach((item, idx) => {
              setTimeout(() => {
                const a = document.createElement('a');
                a.href = item.href;
                if (item.name) a.download = item.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
              }, idx * 150);
            });
          }}>Download All Images</button>
        </div>
      </div>
    </div>
  );
}
