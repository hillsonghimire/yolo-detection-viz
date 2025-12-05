import React, { useEffect, useMemo, useRef, useState } from "react";
import ModelSelector from "./components/ModelSelector.jsx";
import UploadPanel from "./components/UploadPanel.jsx";
import DetectPanel from "./components/DetectPanel.jsx";
import ConfidenceRail from "./components/ConfidenceRail.jsx";
import SampleGallery from "./components/SampleGallery.jsx";
import BulkPanel from "./components/BulkPanel.jsx";
import { detectOnce, measureKernel, getJob, downloadMeasure, runFhbFieldPipeline, downloadUrl, downloadMedia } from "./lib/api.js";
import ZoomableImage from "./components/ZoomableImage.jsx";
import AboutModal from "./components/AboutModal.jsx";
import "./styles.css";

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? "dark" : "light";
  });
  const [model, setModel] = useState("spike");
  const [file, setFile] = useState(null);
  const [imageURL, setImageURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState([]);
  const [meta, setMeta] = useState(null);
  const [conf, setConf] = useState(0.3);
  const [msg, setMsg] = useState("");
  const [fhbFieldResult, setFhbFieldResult] = useState(null);
  const [bulkMode, setBulkMode] = useState(false);
  // kernel measurement state
  const [km, setKm] = useState({ sidemm: 40, allowedIds: "425,100,201,310", useSam: true, samCheckpoint: "models/sam_vit_b_01ec64.pth", samModelType: "vit_b" });
  const [kmJobId, setKmJobId] = useState("");
  const [kmOverlay, setKmOverlay] = useState("");
  const [kmCSV, setKmCSV] = useState("");
  const [downloadPreviewOpen, setDownloadPreviewOpen] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [selectedDownloadKey, setSelectedDownloadKey] = useState(null);
  const [pipelineStage, setPipelineStage] = useState(null); // 0=spike,1=orientation,2=fhb
  const [previewLimit, setPreviewLimit] = useState({});
  const [showAbout, setShowAbout] = useState(false);
  const arucoPdfHref = `${import.meta.env.BASE_URL}A4-Aruco.pdf`;
  const isFhbField = model === "fhb_field";
  const bulkDisabled = isFhbField;

  const aboutProfiles = useMemo(
    () => [
      {
        name: "Prof. Maitiniyazi Maimaitijiang",
        title: "Project Lead | Assistant Professor",
        department: "Department of Geography and Geospatial Sciences",
        affiliation: "South Dakota State University",
        image: "/about_profile/Maimaitijiang_Maitiniyazi.avif",
        summary:
          "Prof. Maimaitijiang is an Assistant Professor of Remote Sensing and Geographic Information Systems in the Department of Geography and Geospatial Sciences at South Dakota State University. He earned his Ph.D. from Saint Louis University, specializing in advanced geospatial analytics and computational sensing. His research lies at the intersection of geospatial sciences, computer vision, and AI/machine learning, with applications spanning sustainable agriculture, food and water security, and environmental monitoring from regional to global scales. His work focuses on developing and implementing state-of-the-art geospatial tools and AI methods for precision agriculture and high-throughput plant phenotyping. He has extensive experience modeling plant biophysical and biochemical traits, predicting crop yield, and monitoring plant health, stress, and disease using multimodal, multiscale, and multitemporal remote sensing data—including multispectral, hyperspectral, RGB, thermal, LiDAR, and SAR imagery from satellites, UAVs, and ground platforms. Within Wheat-AI, Prof. Maimaitijiang provides foundational expertise in sensing strategy, model design, and geospatial data integration, ensuring the scientific rigor and real-world applicability of the platform’s phenotyping tools.",
      },
      {
        name: "Dr. Sunish Kumar Sehgal",
        title: "Project Lead | Professor & Winter Wheat Breeder",
        department: "Department of Agronomy, Horticulture and Plant Science",
        affiliation: "South Dakota State University",
        image: "/about_profile/sunish_sehgal.jpeg",
        summary:
          "Dr. Sunish Kumar Sehgal received his Ph.D. in Plant Breeding and Genetics from Punjab Agricultural University and served as a Research Scientist at Kansas State University from 2006 to 2014. Since joining South Dakota State University in 2014, he has led the Winter Wheat Breeding Program, spearheading efforts to develop and release high-yielding cultivars adapted to the Northern Great Plains. His research focuses on improving wheat resilience to both biotic stresses—such as Fusarium head blight (FHB), stripe rust, leaf rust, stem rust, and wheat streak mosaic virus—and abiotic stresses including winter hardiness and drought. Under his leadership, the program integrates modern genomics, field-based phenotyping, and precision agriculture tools to accelerate cultivar development. Beyond research, Dr. Sehgal is actively engaged in teaching, advising graduate students, and supporting industry outreach across South Dakota’s wheat sector. He has authored more than 80 peer-reviewed publications spanning high-impact journals, including work featured in Nature, Science, PNAS, Genome Biology, Plant Physiology, New Phytologist, Genetics, and Theoretical and Applied Genetics.",
      },
      {
        name: "Hillson Ghimire",
        title: "Lead AI Engineer & Platform Developer | Graduate Research Assistant",
        department: "Department of Geography and Geospatial Sciences",
        affiliation: "South Dakota State University",
        image: "/about_profile/Ghimire_Hillson.avif",
        summary:
          "Hillson Ghimire is the Lead Technical Developer of the Wheat-AI platform, where he is responsible for building the AI models, data pipelines, and deployment systems that power wheatai.net. As a Graduate Research Assistant with the Geospatial Sciences Center of Excellence, he integrates machine learning, computer vision, remote sensing, and cloud engineering to create high-throughput digital tools for breeding applications. He has developed deep-learning models for phenotyping tasks, including spike and spikelet detection, orientation analysis, kernel measurement, and FHB/FDK severity assessment, by employing orientation-aware bounding boxes, multi-scale training strategies, and high-resolution close-range imagery. His technical work spans the entire development lifecycle, covering annotation workflows, geospatial preprocessing, HPC training, and maintaining robust MLOps systems using Docker, CVAT, GCP, and Django for deployment. Hillson’s broader focus is on geospatial AI, remote sensing, and high-throughput plant phenotyping, with the goal of creating scalable, field-ready sensing systems that accelerate wheat breeding and precision agriculture.",
      },
      {
        name: "Dr. Subash Thapa",
        title: "Co-Developer | Ph.D. Researcher, Graduate Research Assistant",
        department: "Department of Agronomy, Horticulture and Plant Science",
        affiliation: "South Dakota State University",
        image: "/about_profile/Subash%20Thapa.avif",
        summary:
          "Subash Thapa is a Ph.D. researcher in Plant Science at South Dakota State University, specializing in quantitative phenotyping and breeding wheat for improved resilience to major biotic and abiotic stresses. As a key contributor to the Wheat-AI project, he provides the critical biological perspective that connects field reality with computational modeling. Subash supports the development and validation of AI-driven disease models, particularly those targeting Fusarium Head Blight (FHB) and Fusarium-Damaged Kernels (FDK). His expertise in field pathology, trait interpretation, and phenotypic evaluation ensures that model predictions derived from high-resolution imagery are scientifically robust and accurately reflect disease severity observed in both field and post-harvest assessments. His contributions help ensure that Wheat-AI’s high-throughput outputs are biologically meaningful and directly applicable to accelerating the selection and development of resilient, high-performing wheat cultivars.",
      },
    ],
    []
  );

  // display dimensions shared by both canvases (keeps sizes identical)
  const [disp, setDisp] = useState({ width: 0, height: 0, dpr: 1 });
  const urlRef = useRef(null);
  const bulkModeRef = useRef(bulkMode);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (fhbFieldResult?.downloads?.length) {
      const firstKey = fhbFieldResult.downloads[0].type || fhbFieldResult.downloads[0].label || null;
      setSelectedDownloadKey(firstKey);
      setPreviewLimit({});
    } else {
      setSelectedDownloadKey(null);
      setPreviewLimit({});
    }
  }, [fhbFieldResult]);

  useEffect(() => {
    if (selectedDownloadKey) {
      const bundle = fhbFieldResult?.downloads?.find((d, idx) => (d.type || d.label || String(idx)) === selectedDownloadKey);
      const defaultLimit = (bundle?.type === 'spike_detection') ? 2 : 3;
      setPreviewLimit((prev) => prev[selectedDownloadKey] ? prev : { ...prev, [selectedDownloadKey]: defaultLimit });
    }
  }, [selectedDownloadKey, fhbFieldResult]);

  useEffect(() => {
    const href = `${import.meta.env.BASE_URL}background.jpg`;
    document.body.style.setProperty('--app-background-image', `url("${href}")`);
    return () => {
      document.body.style.removeProperty('--app-background-image');
    };
  }, []);

  // ——— helpers to keep class colors consistent with DetectPanel ———
  const hash = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const colorOfKey = (key) => {
    const h = hash(String(key)) % 360;
    const s = 72; // %
    const l = 52; // %
    return {
      chip: `hsl(${h} ${s}% ${l}%)`,               // badge background
      textOnChip: "#fff",
      dot: `hsl(${h} ${s}% ${Math.max(l - 8, 30)}%)`,
    };
  };

  const filtered = useMemo(
    () => raw.filter((d) => (d.confidence ?? d.conf ?? 0) >= conf),
    [raw, conf]
  );

  // Per-class counts for filtered (left of slash) and all raw (right of slash)
  const fallbackWidth = 420;
  const fallbackHeight = Math.round(fallbackWidth * 0.75);
  const placeholderWidth = Math.round(disp?.width || fallbackWidth);
  const placeholderHeight = Math.round(disp?.height || fallbackHeight);
  const kernelFrameHeight = Math.max(240, Math.round((placeholderHeight || fallbackHeight) * 1.5));

  const setNewFile = (f) => {
    setFile(f || null);
    setRaw([]);
    setMeta(null);
    setMsg("");
    setFhbFieldResult(null);
    setDownloadPreviewOpen({});
    setLightbox(null);
    setSelectedDownloadKey(null);
    setPipelineStage(null);
    setPreviewLimit({});
    setKmJobId(""); setKmOverlay(""); setKmCSV("");
    setBulkMode(false);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = f ? URL.createObjectURL(f) : null;
    setImageURL(urlRef.current || "");
  };

  useEffect(() => {
    bulkModeRef.current = bulkMode;
  }, [bulkMode]);

  useEffect(() => {
    if (model === 'fhb_field') {
      setBulkMode(false);
      bulkModeRef.current = false;
    } else if (bulkModeRef.current) {
      return;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setFile(null);
    setImageURL("");
    setRaw([]);
    setMeta(null);
    setMsg("");
    setKmJobId("");
    setKmOverlay("");
    setKmCSV("");
    setDownloadPreviewOpen({});
    setLightbox(null);
    setSelectedDownloadKey(null);
    setPipelineStage(null);
    setPreviewLimit({});
    setFhbFieldResult(null);
  }, [model]);

  const onRun = async () => {
    if (!file) return;
    setBusy(true);
    setMsg("");
    if (model !== 'fhb_field') {
      setPipelineStage(null);
    }
    let midStageTimer = null;
    try {
      if (model === 'fhb_field') {
        setPipelineStage(0);
        midStageTimer = setTimeout(() => setPipelineStage(1), 1200);
        const data = await runFhbFieldPipeline({ file });
        setFhbFieldResult(data || null);
        setDownloadPreviewOpen({});
        const firstKey = data?.downloads?.[0]?.type || data?.downloads?.[0]?.label || null;
        setSelectedDownloadKey(firstKey);
        setPipelineStage(2);
        setRaw([]);
        setMeta(null);
      } else if (model === 'kernel') {
        const { unique_id } = await measureKernel({
          file,
          model: 'kernel',
          sidemm: km.sidemm,
          allowedIds: km.allowedIds,
          useSam: km.useSam,
          samCheckpoint: km.samCheckpoint,
          samModelType: km.samModelType,
        });
        setKmJobId(unique_id);
        // poll job until DONE (basic, time-limited)
        const deadline = Date.now() + 60000; // 60s
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1500));
          const job = await getJob(unique_id);
          if (job?.status === 'DONE') {
            try {
              const res = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
              const ovRel = res?.measurement_overlay || '';
              const csvRel = res?.measurement_csv || '';
              if (ovRel) {
                const fname = ovRel.split('/').pop();
                setKmOverlay(downloadMeasure('image', fname));
              }
              if (csvRel) {
                const fname = csvRel.split('/').pop();
                setKmCSV(downloadMeasure('csv', fname));
              }
            } catch {}
            break;
          }
          if (job?.status === 'FAILED') {
            setMsg('Measurement failed');
            break;
          }
        }
      } else {
        // ONE request; later filtering is client-side
        const data = await detectOnce({ file, model, minConf: 0.05 });
        const dets = Array.isArray(data?.detections) ? data.detections : [];
        const metaPayload = (data?.image_width && data?.image_height)
          ? { image_width: data.image_width, image_height: data.image_height }
          : null;
        setRaw(dets);
        setMeta(metaPayload);
      }
    } catch (e) {
      setMsg(String(e.message || e));
      if (model === 'fhb_field') setPipelineStage(null);
    } finally {
      if (midStageTimer) clearTimeout(midStageTimer);
      setBusy(false);
    }
  };

  const onPickSample = async (url) => {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const f = new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
    setNewFile(f);
  };

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <a className="brand-logo" href="https://wheatai.net" aria-label="Go to WheatAI homepage">
            <img className="app-logo" src="/logo/Logo_2.png" alt="WheatAI logo" />
          </a>
          <div className="brand-copy">
            <span className="brand-name">WheatAI</span>
            <span className="brand-tagline">AI-based wheat assessment</span>
          </div>
        </div>
        <div className="header-actions">
          <a
            className="contact-link contact-link--block"
            href="mailto:maitiniyazi.maimaitijiang@sdstate.edu,sunish.sehgal@sdstate.edu?subject=WheatAI%3A&cc=hillson.ghimire@sdstate.edu"
            aria-label="Email WheatAI team"
          >
            <span className="contact-icon" aria-hidden="true">✉</span>
            <span className="contact-text">Contact</span>
          </a>
          <button
            className="contact-link contact-link--block"
            type="button"
            onClick={() => setShowAbout(true)}
            aria-label="Open About WheatAI"
          >
            <span className="contact-icon" aria-hidden="true">ℹ</span>
            <span className="contact-text">About</span>
          </button>
          <div className="contact-link contact-link--block theme-toggle" role="group" aria-label="Toggle between day and night theme">
            <span className="theme-toggle__icon" aria-hidden="true">☀</span>
            <label className="theme-toggle__track">
              <input
                className="theme-toggle__input"
                type="checkbox"
                checked={theme === "dark"}
                onChange={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                aria-label={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
              />
              <span className="theme-toggle__thumb" aria-hidden="true" />
            </label>
            <span className="theme-toggle__icon" aria-hidden="true">☾</span>
          </div>
        </div>
        <div className="brand brand--mirror">
          <div className="brand-logo brand-logo--mirror">
            <img className="app-logo app-logo--winter" src="/logo/WinterWheatLogo.png" alt="Winter Wheat logo" />
          </div>
        </div>
      </div>
      {/* <p className="sub">Upload an image to detect wheat spikes / spikelets with AI.</p> */}

      <div className="topbar">
        <ModelSelector model={model} setModel={setModel} />
        <div className="mode-toggle">
          <span className="mode-toggle__label small">Processing Mode</span>
          <div className="mode-toggle__options" role="group" aria-label="Choose processing mode">
            <button
              type="button"
              className={`mode-toggle__option ${!bulkMode ? "active" : ""}`}
              onClick={() => setBulkMode(false)}
              disabled={bulkDisabled}
              aria-disabled={bulkDisabled}
              aria-pressed={!bulkMode}
            >
              Single
            </button>
            <button
              type="button"
              className={`mode-toggle__option ${bulkMode ? "active" : ""}`}
              onClick={() => setBulkMode(true)}
              disabled={bulkDisabled}
              aria-disabled={bulkDisabled}
              aria-pressed={bulkMode}
            >
              Bulk
            </button>
          </div>
        </div>
        {/* legend chips removed to avoid duplication; stats now inside detection panel */}
      </div>

      {!bulkMode && (
        <div className="card input-card">
          <div className="input-header">
            <h3>Select or Upload Image</h3>
            <div className="small" style={{ marginLeft: 'auto' }}>Pick a sample or upload your own</div>
          </div>
          <div className="input-grid">
            <div className="input-upload">
              <UploadPanel
                onFile={setNewFile}
                imageURL={imageURL}
                fileName={file?.name || null}
                onRun={onRun}
                busy={busy}
                disp={disp}
                setDisp={setDisp}
              />
            </div>
            <div className="input-gallery">
              <SampleGallery model={model} onPick={onPickSample} />
            </div>
          </div>
        </div>
      )}

      {msg && <div style={{ color: "#d33", marginTop: 8 }}>{msg}</div>}

      {!bulkMode && model !== 'kernel' && model !== 'fhb_field' && (
        <section className="detect-frame">
          <DetectPanel
            imageURL={imageURL}
            detections={filtered}
            allDetections={raw}
            meta={meta}
            disp={disp}
            imageName={file?.name || null}
            model={model}
          />
          <div className="detect-controls">
            <ConfidenceRail value={conf} onChange={setConf} />
          </div>
        </section>
      )}

      {!bulkMode && isFhbField && (
        <section className="detect-frame">
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="input-header" style={{ alignItems: 'flex-start' }}>
              <h3>FHB Field Pipeline</h3>
              <div className="small" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {["Spike detection", "Orientation filtering", "FHB scoring"].map((label, idx) => {
                  const active = pipelineStage === idx || (pipelineStage === null && fhbFieldResult && idx === 2);
                  return (
                    <span key={idx} style={{ color: active ? '#c62828' : 'var(--muted)', fontWeight: active ? 700 : 500 }}>
                      {label}{idx < 2 ? " →" : ""}
                    </span>
                  );
                })}
                <span className="small" style={{ color: 'var(--muted)' }}>on the selected demo image(s).</span>
              </div>
            </div>
            {fhbFieldResult ? (
              <>
                <div className="small" style={{ color: 'var(--muted)' }}>
                  Run <strong>{fhbFieldResult.run_name || "latest"}</strong> · Inputs: {Array.isArray(fhbFieldResult.inputs) ? fhbFieldResult.inputs.length : 0}
                  {fhbFieldResult.results_root ? ` · Outputs saved under media/${fhbFieldResult.results_root}` : ""}
                </div>
                {fhbFieldResult.downloads?.length ? (() => {
                  const downloads = fhbFieldResult.downloads;
                  const active = downloads.find((d, idx) => (d.type || d.label || String(idx)) === selectedDownloadKey) || downloads[0];
                  const activeKey = active ? (active.type || active.label || "active") : null;
                  const previews = Array.isArray(active?.previews) ? active.previews : [];
                  const limit = activeKey ? (previewLimit[activeKey] ?? 2) : 2;
                  const visiblePreviews = previews.slice(0, limit);
                  return (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <div className="card" style={{ padding: 10, minWidth: 240, maxWidth: 280 }}>
                        <div className="small" style={{ marginBottom: 6, color: 'var(--muted)' }}>Downloads</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {downloads.map((d, idx) => {
                            const key = d.type || d.label || String(idx);
                            const isActive = key === activeKey;
                            return (
                              <div key={key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className={`btn outline${isActive ? " active" : ""}`}
                                  onClick={() => setSelectedDownloadKey(key)}
                                  style={{ flex: 1 }}
                                >
                                  {d.label || d.type || `Bundle ${idx + 1}`}
                                </button>
                                <a
                                  className="btn"
                                  href={downloadMedia(d.path)}
                                  download
                                  title="Download"
                                  style={{ padding: "6px 10px" }}
                                >
                                  ⬇
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="card" style={{ padding: 10, flex: 1, minWidth: 280 }}>
                        {active ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <div className="small" style={{ color: 'var(--muted)' }}>
                                {active.label || active.type || "Selected bundle"}
                              </div>
                              <a className="btn" href={downloadMedia(active.path)} download>
                                ⬇ Download
                              </a>
                            </div>
                            <div style={{ marginTop: 10 }}>
                              {visiblePreviews.length ? (
                                <>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
                                    {visiblePreviews.map((p, i) => (
                                      <div key={i} style={{ border: '1px solid var(--line)', padding: 6, borderRadius: 6, background: 'var(--panel)' }}>
                                        <img
                                          src={downloadMedia(p)}
                                          alt={active.label || active.type || "preview"}
                                          style={{ width: "100%", height: "200px", objectFit: "contain", borderRadius: 4, cursor: "pointer", background: "#000" }}
                                          onClick={() => setLightbox({ src: downloadMedia(p), alt: active.label || active.type || "preview" })}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  {previews.length > visiblePreviews.length ? (
                                    <div style={{ marginTop: 10 }}>
                                      <button
                                        type="button"
                                        className="btn outline"
                                        onClick={() => {
                                          if (activeKey) {
                                            setPreviewLimit((prev) => ({
                                              ...prev,
                                              [activeKey]: Math.min(previews.length, (prev[activeKey] ?? 2) + 4),
                                            }));
                                          }
                                        }}
                                      >
                                        View more (+4)
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="small" style={{ color: 'var(--muted)' }}>
                                  No preview images available for this bundle.
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="small" style={{ color: 'var(--muted)' }}>Select a bundle to view previews.</div>
                        )}
                      </div>
                    </div>
                  );
                })() : null}
                {Array.isArray(fhbFieldResult.summary) && fhbFieldResult.summary.length > 0 ? (
                  <div className="table-wrap" style={{ overflowX: "auto" }}>
                    <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Image</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Spikes (selected)</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Healthy spikelets</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Infected spikelets</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>FHB severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fhbFieldResult.summary.map((row, idx) => (
                          <tr key={idx}>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{row.image_name || row.image || `image_${idx + 1}`}</td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>{row.num_spikes ?? row.spikes ?? "-"}</td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>{row.fhb_noninfected_spikelets ?? row.healthy ?? 0}</td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>{row.fhb_infected_spikelets ?? row.infected ?? 0}</td>
                            <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>
                              {(() => {
                                const severityValue = row.severity ?? row.FHB_severity;
                                if (severityValue !== undefined && severityValue !== null) {
                                  const pct = Number(severityValue);
                                  if (!Number.isNaN(pct)) {
                                    return `${pct.toFixed(1)}%`;
                                  }
                                }
                                const healthy = Number(row.fhb_noninfected_spikelets ?? row.healthy ?? 0);
                                const infected = Number(row.fhb_infected_spikelets ?? row.infected ?? 0);
                                const total = healthy + infected;
                                if (!total) return "0.0%";
                                const pct = (infected / total) * 100;
                                return `${pct.toFixed(1)}%`;
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="small" style={{ color: 'var(--muted)' }}>
                    Pipeline finished but no spikelets were scored in the crops.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {fhbFieldResult.excel_name && (
                    <a
                      className="btn"
                      href={downloadUrl('excel', fhbFieldResult.excel_name)}
                      download={fhbFieldResult.excel_name}
                    >
                      Download Excel summary
                    </a>
                  )}
                  {fhbFieldResult.overlays?.length ? (
                    <span className="small" style={{ color: 'var(--muted)' }}>
                      Overlays saved in {fhbFieldResult.overlays.length} files under media/{fhbFieldResult.results_root || ""}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="small" style={{ color: 'var(--muted)' }}>
                Pick a demo image and start processing to run the full FHB field pipeline. Results and downloads will appear here.
              </div>
            )}
          </div>
        </section>
      )}

      {!bulkMode && model === 'kernel' && (
        <section className="detect-frame">
          <div className="panel" style={{ flex: 1, minHeight: 120, display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-start' }}>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              {imageURL ? (
                <ZoomableImage
                  src={kmOverlay || imageURL}
                  placeholder={"Upload an image to preview it here."}
                  frameWidth={placeholderWidth}
                  frameHeight={kernelFrameHeight}
                  downloads={[
                    ...(kmCSV ? [{
                      href: kmCSV,
                      label: "Download CSV",
                      downloadName: kmCSV.split("/").pop() || undefined,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                      ),
                    }] : []),
                    ...(kmOverlay ? [{
                      href: kmOverlay,
                      label: "Download image",
                      downloadName: kmOverlay.split("/").pop() || undefined,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="3" width="18" height="14" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <path d="M21 17l-5-5-4 4-2-2-5 5"></path>
                        </svg>
                      ),
                    }] : []),
                  ]}
                />
              ) : (
                <div
                  className="detect-placeholder"
                  style={{ width: placeholderWidth, height: kernelFrameHeight }}
                >
                  <div className="placeholder-text">Upload an image to preview it here.</div>
                </div>
              )}
              {imageURL && !kmOverlay && (
                <div className="small" style={{ color: 'var(--muted)' }}>
                  Submit to generate the measurement overlay and CSV.
                </div>
              )}
            </div>
            <div style={{ padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--line)' }}>
              <a
                className="btn outline"
                href={arucoPdfHref}
                download="A4-Aruco.pdf"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                🖨️ Download ArUco PDF
              </a>
              <label className="small">ArUco Physical Size (mm)</label>
              <input className="input" style={{ width: 90 }} type="number" min="0.1" step="0.1" value={km.sidemm}
                onChange={(e)=> setKm(v=> ({...v, sidemm: parseFloat(e.target.value)||0}))} />
              <label className="small">ArUco IDs</label>
              <input className="input" style={{ width: 200 }} type="text" value={km.allowedIds}
                onChange={(e)=> setKm(v=> ({...v, allowedIds: e.target.value}))} placeholder="425,100,201,310" />
              <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={km.useSam} onChange={(e)=> setKm(v=> ({...v, useSam: e.target.checked}))} /> SAM
              </label>
              <input className="input" style={{ width: 240 }} type="text" disabled={!km.useSam}
                value={km.samCheckpoint} onChange={(e)=> setKm(v=> ({...v, samCheckpoint: e.target.value}))} placeholder="models/sam_vit_b_01ec64.pth" />
              <select className="select" disabled={!km.useSam} value={km.samModelType}
                onChange={(e)=> setKm(v=> ({...v, samModelType: e.target.value}))}>
                <option value="vit_b">vit_b</option>
                <option value="vit_l">vit_l</option>
                <option value="vit_h">vit_h</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {bulkMode && !isFhbField && (
        <BulkPanel
          model={model}
          onExit={() => setBulkMode(false)}
          kernelParams={km}
          setKernelParams={setKm}
        />
      )}

      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} profiles={aboutProfiles} />

      {lightbox?.src && (
        <div
          className="lightbox"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setLightbox(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "90vw",
              maxHeight: "90vh",
              background: "#000",
              borderRadius: 8,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setLightbox(null)}
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                background: "rgba(0,0,0,0.5)",
                color: "#fff",
                border: "none",
                borderRadius: "50%",
                width: 32,
                height: 32,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ×
            </button>
            <img
              src={lightbox.src}
              alt={lightbox.alt || "preview"}
              style={{
                maxWidth: "90vw",
                maxHeight: "90vh",
                display: "block",
                objectFit: "contain",
                borderRadius: 8,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
