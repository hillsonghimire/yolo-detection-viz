import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Left panel (input). Keeps aspect ratio and computes display size (disp)
 * used by the right panel to match dimensions.
 */
export default function UploadPanel({ onFile, imageURL, fileName, onRun, busy, disp, setDisp }){
  const [drag, setDrag] = useState(false);
  const wrapRef = useRef(null);
  const fileInputRef = useRef(null);
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 0);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  // Compute a shared display size for the detection canvas based on
  // the upload panel column width for consistent layout.
  useEffect(() => {
    const wrap = wrapRef.current;
    const rawWidth = Math.floor(wrap?.clientWidth || 0);
    const maxWidth = 480;
    const minWidth = 260;
    const targetW = Math.min(maxWidth, Math.max(minWidth, rawWidth || maxWidth));
    const ratio = 0.75; // fixed frame aspect (height = width * ratio)
    const targetH = Math.round(targetW * ratio);
    const dpr = window.devicePixelRatio || 1;
    setDisp({ width: targetW, height: targetH, dpr });
  }, [vw]);

  // track viewport width to trigger re-measure on resize
  useEffect(() => {
    const onR = () => setVw(window.innerWidth || 0);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const handleSelect = (f)=> onFile(f || null);

  const prevent = e=>{ e.preventDefault(); e.stopPropagation(); };
  const onDragEnter = e=>{ prevent(e); setDrag(true); };
  const onDragLeave = e=>{ prevent(e); setDrag(false); };
  const onDrop = async e=>{
    prevent(e); setDrag(false);
    const dt = e.dataTransfer;
    if(dt?.files && dt.files[0]) return onFile(dt.files[0]);
    const url = dt.getData("text/uri-list") || dt.getData("text/plain");
    if(url){
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
      return onFile(file);
    }
  };

  const triggerFileDialog = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };

  const handleChooseClick = () => {
    if (busy) return;
    if (disclaimerAccepted) {
      triggerFileDialog();
    } else {
      setShowDisclaimer(true);
    }
  };

  const handleAcceptDisclaimer = () => {
    if (busy) return;
    setDisclaimerAccepted(true);
    setShowDisclaimer(false);
    // Defer opening the file picker until after the overlay unmounts
    setTimeout(() => {
      triggerFileDialog();
    }, 0);
  };

  const handleDeclineDisclaimer = () => {
    setShowDisclaimer(false);
    setDisclaimerAccepted(false);
  };

  const disclaimerText = "Please do not upload or include any sensitive, confidential, or personal information in your submission. All tasks and files submitted will be publicly accessible. Ensure that any data you provide is appropriate for public sharing and does not contain private credentials, proprietary content, or identifying details.";
  const canPortal = typeof document !== "undefined";

  return (
    <div
      className={"panel" + (drag ? " dragover" : "")}
      onDragEnter={onDragEnter}
      onDragOver={prevent}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{ minHeight: 140, overflow: "visible" }}
    >
      <div className="drop-hint"></div>
      <div ref={wrapRef} style={{ width: "100%", textAlign: "center", padding: 16 }}>
        <p className="small" style={{ marginTop: 0, color: 'var(--fg)' }}>
          Drop image here or select a file
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleSelect(e.target.files?.[0] || null)}
            style={{ display: "none" }}
          />
          <div className="disclaimer-wrap">
            <button
              className="btn"
              type="button"
              onClick={handleChooseClick}
              disabled={busy}
              title="Select an image file"
            >
              Choose Image
            </button>
            {showDisclaimer && !busy && canPortal && createPortal(
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
          <button className="btn" onClick={onRun} disabled={busy || !imageURL}>
            {busy ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" aria-hidden /> Processing…
              </span>
            ) : (
              "Start Processing"
            )}
          </button>
          {imageURL && (
            <button
              className="btn clear-btn"
              type="button"
              onClick={() => onFile(null)}
              disabled={busy}
              title="Clear current image"
            >
              Clear
            </button>
          )}
        </div>
        <div className="small" style={{ marginTop: 8, color: imageURL ? 'var(--fg)' : 'var(--muted)' }}>
          {imageURL ? (fileName || 'Selected image') : 'No file selected'}
        </div>
      </div>
    </div>
  );
}
