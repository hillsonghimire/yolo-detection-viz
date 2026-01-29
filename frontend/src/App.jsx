import React, { useEffect, useMemo, useRef, useState } from "react";
import UploadPanel from "./components/UploadPanel.jsx";
import DetectPanel from "./components/DetectPanel.jsx";
import ConfidenceRail from "./components/ConfidenceRail.jsx";
import SampleGallery from "./components/SampleGallery.jsx";
import BulkPanel from "./components/BulkPanel.jsx";
import {
  detectOnce,
  measureKernel,
  measureStomata,
  getJob,
  downloadMeasure,
  runFhbFieldPipeline,
  downloadUrl,
  downloadMedia,
  loginUser,
  registerUser,
  verifyEmail,
  resendVerification,
  fetchMe,
  clearTokens,
  getStoredTokens,
} from "./lib/api.js";
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
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    organization: "",
  });
  const [authError, setAuthError] = useState("");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [authStep, setAuthStep] = useState("form");
  const [verifyEmailInput, setVerifyEmailInput] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [navOpen, setNavOpen] = useState(false);
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
  // stomata measurement state
  const [st, setSt] = useState({ umPerPx: 0.3448275862, conf: 0.25, iou: 0.7 });
  const [stJobId, setStJobId] = useState("");
  const [stOverlay, setStOverlay] = useState("");
  const [stExcel, setStExcel] = useState("");
  const [stSummary, setStSummary] = useState(null);
  const [stInstances, setStInstances] = useState([]);
  const [stInstanceLimit, setStInstanceLimit] = useState(20);
  const [downloadPreviewOpen, setDownloadPreviewOpen] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [selectedDownloadKey, setSelectedDownloadKey] = useState(null);
  const [pipelineStage, setPipelineStage] = useState(null); // 0=spike,1=orientation,2=fhb
  const [previewLimit, setPreviewLimit] = useState({});
  const [summaryLimit, setSummaryLimit] = useState(10);
  const [showAbout, setShowAbout] = useState(false);
  const arucoPdfHref = `${import.meta.env.BASE_URL}A4-Aruco.pdf`;
  const isFhbField = model === "fhb_field";
  const bulkDisabled = isFhbField;
  const menuItems = [
    { key: "spike", label: "Wheat Spike", hint: "Spike detection and counting" },
    { key: "uav_spike", label: "UAV Spikes", hint: "Aerial spike detection (UAV)" },
    { key: "spikelet", label: "Wheat Spikelet", hint: "Spikelet detection and counts" },
    { key: "kernel", label: "Kernel Morphology", hint: "Kernel measurements + CSV" },
    { key: "fhb", label: "FHB", hint: "Fusarium head blight scoring" },
    { key: "fdk", label: "FDK", hint: "Fusarium damaged kernel" },
    { key: "stomata", label: "Stomata", hint: "Stomata morphology + tables" },
  ];
  const activeMenuKey = model === "fhb_field" ? "fhb" : model;
  const activeMenu = menuItems.find((item) => item.key === activeMenuKey) || menuItems[0];
  const pageTitle = model === "fhb_field" ? "FHB Field Pipeline" : activeMenu.label;
  const pageSubtitle = model === "fhb_field"
    ? "Multi-stage field pipeline with spike detection, orientation filtering, and FHB scoring."
    : activeMenu.hint;

  // display dimensions shared by both canvases (keeps sizes identical)
  const [disp, setDisp] = useState({ width: 0, height: 0, dpr: 1 });
  const urlRef = useRef(null);
  const bulkModeRef = useRef(bulkMode);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verify");
    if (!token) return;
    (async () => {
      try {
        await verifyEmail({ token });
        setAuthMode("login");
        setAuthStep("form");
        setAuthError("Email verified. Please sign in.");
      } catch (err) {
        setAuthError(String(err.message || err));
      } finally {
        setAuthModalOpen(true);
      }
    })();
  }, []);

  const loadSession = async () => {
    const tokens = getStoredTokens();
    if (!tokens) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    try {
      const me = await fetchMe();
      setUser(me.user || null);
    } catch (e) {
      clearTokens();
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadSession();
      if (!mounted) return;
    })();
    return () => { mounted = false; };
  }, []);


  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      await loginUser({ username: authForm.username, password: authForm.password });
      await loadSession();
      setAuthModalOpen(false);
    } catch (err) {
      setAuthError(String(err.message || err));
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      await registerUser({
        username: authForm.username,
        email: authForm.email,
        password: authForm.password,
        confirmPassword: authForm.confirmPassword,
        firstName: authForm.firstName,
        lastName: authForm.lastName,
        organization: authForm.organization,
      });
      setAuthStep("verify");
      setVerifyEmailInput(authForm.email);
      setAuthError("Verification email sent. Enter the OTP to finish setup.");
    } catch (err) {
      setAuthError(String(err.message || err));
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      await verifyEmail({ email: verifyEmailInput, otpCode, token: "" });
      setAuthMode("login");
      setAuthStep("form");
      setAuthError("Email verified. Please sign in.");
    } catch (err) {
      setAuthError(String(err.message || err));
    }
  };

  const handleResend = async () => {
    setAuthError("");
    try {
      await resendVerification(verifyEmailInput);
      setAuthError("Verification email resent.");
    } catch (err) {
      setAuthError(String(err.message || err));
    }
  };

  const handleLogout = () => {
    clearTokens();
    setUser(null);
    setUserMenuOpen(false);
  };

  useEffect(() => {
    if (fhbFieldResult?.downloads?.length) {
      const firstKey = fhbFieldResult.downloads[0].type || fhbFieldResult.downloads[0].label || null;
      setSelectedDownloadKey(firstKey);
      setPreviewLimit({});
      setSummaryLimit(10);
    } else {
      setSelectedDownloadKey(null);
      setPreviewLimit({});
      setSummaryLimit(10);
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

  const isRegister = authMode === "register";

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

  // Keep filtered detections separate from raw results for slider-based filtering
  const fallbackWidth = 420;
  const fallbackHeight = Math.round(fallbackWidth * 0.75);
  const placeholderWidth = Math.round(disp?.width || fallbackWidth);
  const placeholderHeight = Math.round(disp?.height || fallbackHeight);
  const kernelFrameHeight = Math.max(240, Math.round((placeholderHeight || fallbackHeight) * 1.5));
  const formatValue = (v) => {
    if (v == null || Number.isNaN(v)) return "—";
    if (typeof v === "number") {
      if (Number.isInteger(v)) return v;
      return v.toFixed(3);
    }
    return String(v);
  };

  const setNewFile = (f, previewUrl = "") => {
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
    setStJobId(""); setStOverlay(""); setStExcel(""); setStSummary(null); setStInstances([]); setStInstanceLimit(20);
    setBulkMode(false);
    if (urlRef.current && urlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(urlRef.current);
    }
    if (f && previewUrl) {
      urlRef.current = previewUrl;
    } else {
      urlRef.current = f ? URL.createObjectURL(f) : null;
    }
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
    if (urlRef.current && urlRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(urlRef.current);
    }
    urlRef.current = null;
    setFile(null);
    setImageURL("");
    setRaw([]);
    setMeta(null);
    setMsg("");
    setKmJobId("");
    setKmOverlay("");
    setKmCSV("");
    setStJobId("");
    setStOverlay("");
    setStExcel("");
    setStSummary(null);
    setStInstances([]);
    setStInstanceLimit(20);
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
      } else if (model === 'stomata') {
        const { unique_id } = await measureStomata({
          file,
          umPerPx: st.umPerPx,
          conf: st.conf,
          iou: st.iou,
        });
        setStJobId(unique_id);
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 1500));
          const job = await getJob(unique_id);
          if (job?.status === 'DONE') {
            try {
              const res = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
              const overlayRel = res?.stomata_overlay || '';
              const excelRel = res?.stomata_excel || '';
              if (overlayRel) setStOverlay(downloadMedia(overlayRel));
              if (excelRel) setStExcel(downloadMedia(excelRel));
              setStSummary(res?.summary || null);
              setStInstances(Array.isArray(res?.instances) ? res.instances : []);
              setStInstanceLimit(20);
            } catch {}
            break;
          }
          if (job?.status === 'FAILED') {
            setMsg('Stomata measurement failed');
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

  const onPickSample = async (url, previewUrl = "") => {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const f = new File([blob], url.split("/").pop() || "sample.jpg", { type: blob.type || "image/jpeg" });
    setNewFile(f, previewUrl);
  };

  if (authLoading) {
    return (
      <div className="app-shell">
        <div className="loading-card">
          <h2 style={{ marginTop: 0 }}>Loading...</h2>
          <p>Checking your session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <button
          className="nav-toggle"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="topbar__brand">
          <img className="topbar__logo" src="/logo/Logo_2.png" alt="WheatAI logo" />
          <div className="topbar__titles">
            <span className="topbar__name">WheatAI</span>
            <span className="topbar__tag">AI-based Wheat Phenotyping Platform</span>
          </div>
        </div>
        <div className="topbar__actions">
          <div className="user-menu">
            {user ? (
              <>
                <button
                  className="topbar__account"
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                >
                  <span className="account-dot" aria-hidden="true">●</span>
                  <span>{user.username}</span>
                </button>
                {userMenuOpen && (
                  <div className="user-menu__dropdown">
                    <button className="user-menu__item" type="button" onClick={handleLogout}>
                      Log out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                className="topbar__account"
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setAuthStep("form");
                  setAuthError("");
                  setAuthModalOpen(true);
                }}
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="app-body">
        {navOpen && (
          <div
            className="nav-scrim"
            role="button"
            aria-label="Close navigation"
            tabIndex={0}
            onClick={() => setNavOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setNavOpen(false);
            }}
          />
        )}
        <aside className={`sidebar ${navOpen ? "sidebar--open" : ""}`}>
          <div className="sidebar__section">
            <div className="sidebar__heading">Models</div>
            <nav className="sidebar__nav">
              {menuItems.map((item) => (
                <button
                  key={item.key}
                  className={`sidebar__item ${activeMenuKey === item.key ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setModel(item.key);
                    setNavOpen(false);
                  }}
                >
                  <div className="sidebar__text">
                    <span className="sidebar__label">{item.label}</span>
                    <span className="sidebar__hint">{item.hint}</span>
                  </div>
                  <span className="sidebar__chev" aria-hidden="true">›</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="sidebar__footer">
            <div className="sidebar__footer-group">
              <button
                className="sidebar__link"
                type="button"
                onClick={() => setShowAbout(true)}
              >
                About
              </button>
              <a
                className="sidebar__link"
                href="mailto:maitiniyazi.maimaitijiang@sdstate.edu,sunish.sehgal@sdstate.edu?subject=WheatAI%3A&cc=hillson.ghimire@sdstate.edu"
              >
                Contact us
              </a>
            </div>
            <div className="sidebar__toggle" role="group" aria-label="Toggle between day and night theme">
              <span className="sidebar__toggle-label">Light / Dark</span>
              <span className="sidebar__toggle-icons" aria-hidden="true">☀</span>
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
              <span className="sidebar__toggle-icons" aria-hidden="true">☾</span>
            </div>
          </div>
        </aside>
        <main className="main">
          <div className="main-inner">
            <div className="page-head">
              <div className="page-title">
                <span className="page-kicker">Model</span>
                <h1>{pageTitle}</h1>
                <p>{pageSubtitle}</p>
              </div>
              <div className="page-actions">
                {activeMenuKey === "fhb" && (
                  <div className="page-switch" role="group" aria-label="FHB mode">
                    <button
                      type="button"
                      className={`btn outline ${model === "fhb" ? "active" : ""}`}
                      onClick={() => setModel("fhb")}
                    >
                      Standard
                    </button>
                    <button
                      type="button"
                      className={`btn outline ${model === "fhb_field" ? "active" : ""}`}
                      onClick={() => setModel("fhb_field")}
                    >
                      Field Pipeline
                    </button>
                  </div>
                )}
                <div className="mode-toggle">
                  <span className="mode-toggle__label small">Processing</span>
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
                      onClick={() => {
                        setBulkMode(true);
                      }}
                      disabled={bulkDisabled}
                      aria-disabled={bulkDisabled}
                      aria-pressed={bulkMode}
                    >
                      Bulk
                    </button>
                  </div>
                </div>
              </div>
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

            {!bulkMode && model !== 'kernel' && model !== 'fhb_field' && model !== 'stomata' && (
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

      {!bulkMode && model === 'stomata' && (
        <section className="detect-frame">
          <div className="panel" style={{ flex: 1, minHeight: 120, display:'flex', flexDirection:'column', alignItems:'stretch', justifyContent:'flex-start' }}>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              {imageURL ? (
                <ZoomableImage
                  src={stOverlay || imageURL}
                  placeholder={"Upload an image to preview it here."}
                  frameWidth={placeholderWidth}
                  frameHeight={kernelFrameHeight}
                  downloads={[
                    ...(stExcel ? [{
                      href: stExcel,
                      label: "Download Excel",
                      downloadName: stExcel.split("/").pop() || undefined,
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                      ),
                    }] : []),
                    ...(stOverlay ? [{
                      href: stOverlay,
                      label: "Download image",
                      downloadName: stOverlay.split("/").pop() || undefined,
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
              {imageURL && !stOverlay && (
                <div className="small" style={{ color: 'var(--muted)' }}>
                  Submit to generate the stomata overlay and Excel table.
                </div>
              )}
            </div>
            <div style={{ padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--line)' }}>
              <label className="small">um per pixel</label>
              <input className="input" style={{ width: 120 }} type="number" min="0.001" step="0.001" value={st.umPerPx}
                onChange={(e)=> setSt(v=> ({...v, umPerPx: parseFloat(e.target.value)||0}))} />
              <label className="small">Confidence</label>
              <input className="input" style={{ width: 100 }} type="number" min="0" max="1" step="0.01" value={st.conf}
                onChange={(e)=> setSt(v=> ({...v, conf: parseFloat(e.target.value)||0}))} />
              <label className="small">IOU</label>
              <input className="input" style={{ width: 90 }} type="number" min="0" max="1" step="0.01" value={st.iou}
                onChange={(e)=> setSt(v=> ({...v, iou: parseFloat(e.target.value)||0}))} />
            </div>
            <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
              {stSummary ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <h4 style={{ margin: '0 0 8px' }}>Stomata Summary</h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Metric</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(stSummary).map(([key, val]) => (
                            <tr key={key}>
                              <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{key}</td>
                              <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{formatValue(val)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {stInstances.length ? (
                    <div>
                      <h4 style={{ margin: '0 0 8px' }}>Instance Table</h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>UID</th>
                              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Class</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Length (um)</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Width (um)</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Area (um^2)</th>
                              <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Conf</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stInstances.slice(0, stInstanceLimit).map((row, idx) => (
                              <tr key={`${row.uid || row.instance || idx}`}>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{row.uid ?? "-"}</td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{row.class_id ?? "-"}</td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{formatValue(row["length_µm"])}</td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{formatValue(row["width_µm"])}</td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{formatValue(row["area_µm²"])}</td>
                                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{formatValue(row.confidence)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {stInstances.length > stInstanceLimit ? (
                        <button
                          type="button"
                          className="btn outline"
                          style={{ marginTop: 8 }}
                          onClick={() => setStInstanceLimit((prev) => prev + 20)}
                        >
                          Show more (+20)
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="small" style={{ color: 'var(--muted)' }}>
                      No instances found in the output table.
                    </div>
                  )}
                </div>
              ) : (
                <div className="small" style={{ color: 'var(--muted)' }}>
                  Run the stomata pipeline to populate the output tables.
                </div>
              )}
            </div>
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
                                  className="btn soft"
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
                              <a className="btn soft" href={downloadMedia(active.path)} download>
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
                {Array.isArray(fhbFieldResult.summary) && fhbFieldResult.summary.length > 0 ? (() => {
                  const summaryRows = fhbFieldResult.summary || [];
                  const toNumber = (v) => {
                    if (v === null || v === undefined) return null;
                    const num = Number(v);
                    return Number.isFinite(num) ? num : null;
                  };
                  const deriveSeverity = (row) => {
                    const direct = toNumber(row?.severity ?? row?.FHB_severity ?? row?.fhb_severity);
                    if (direct !== null) return direct;
                    const healthy = toNumber(row?.fhb_noninfected_spikelets ?? row?.healthy);
                    const infected = toNumber(row?.fhb_infected_spikelets ?? row?.infected);
                    const total = (healthy || 0) + (infected || 0);
                    if (total > 0) return (infected || 0) / total * 100;
                    return null;
                  };
                  const aggregateLabels = new Set(["average severity", "incidence %", "severity", "disease index"]);
                  const baseRows = summaryRows.filter((row) => {
                    const name = String(row.image_name || row.image || "").trim().toLowerCase();
                    return !aggregateLabels.has(name);
                  });
                  const totalSpikes = baseRows.length;
                  const positiveSev = [];
                  baseRows.forEach((row) => {
                    const sev = deriveSeverity(row);
                    if (sev === null) return;
                    if (sev > 0) positiveSev.push(sev);
                  });
                  const incidence = totalSpikes ? (positiveSev.length / totalSpikes) * 100 : 0;
                  const severityPos = positiveSev.length ? (positiveSev.reduce((a, b) => a + b, 0) / positiveSev.length) : 0;
                  const diseaseIndex = (severityPos * incidence) / 100;
                  const metricRows = [
                    { key: "incidence", label: "Incidence %", value: incidence },
                    { key: "severity", label: "Severity", value: severityPos },
                    { key: "disease_index", label: "Disease Index", value: diseaseIndex },
                  ];
                  if (!totalSpikes) {
                    return (
                      <div className="small" style={{ color: 'var(--muted)' }}>
                        Pipeline finished but no spikelets were scored in the crops.
                      </div>
                    );
                  }
                  const visibleSummary = baseRows.slice(0, summaryLimit);
                  const hasMoreSummary = baseRows.length > summaryLimit;
                  const rowsToRender = [...metricRows, ...visibleSummary];
                  return (
                  <div className="table-wrap" style={{ overflowX: "auto" }}>
                    <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Image</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Healthy spikelets</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>Infected spikelets</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>FHB severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowsToRender.map((row, idx) => {
                          const isMetric = row.key && row.value !== undefined;
                          if (isMetric) {
                            const pct = Number.isFinite(row.value) ? `${row.value.toFixed(1)}%` : "0.0%";
                            return (
                              <tr key={`metric-${row.key}`}>
                                <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", fontWeight: 800 }}>{row.label}</td>
                                <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right", color: 'var(--muted)' }}>—</td>
                                <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right", color: 'var(--muted)' }}>—</td>
                                <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right", fontWeight: 800 }}>{pct}</td>
                              </tr>
                            );
                          }
                          const label = row.image_name || row.image || `image_${idx + 1}`;
                          const healthy = row.fhb_noninfected_spikelets ?? row.healthy ?? 0;
                          const infected = row.fhb_infected_spikelets ?? row.infected ?? 0;
                          const severityValue = deriveSeverity(row);
                          const severityText = Number.isFinite(severityValue) ? `${severityValue.toFixed(1)}%` : "0.0%";
                          return (
                            <tr key={`${label}-${idx}`}>
                              <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{label}</td>
                              <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>{healthy}</td>
                              <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>{infected}</td>
                              <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right" }}>{severityText}</td>
                            </tr>
                          );
                        })}
                        {hasMoreSummary ? (
                          <tr>
                            <td colSpan={5} style={{ padding: "10px 8px", textAlign: "center", borderBottom: "1px solid var(--line)" }}>
                              <button
                                type="button"
                                className="btn outline"
                                onClick={() => setSummaryLimit((prev) => Math.min(baseRows.length, prev + 10))}
                              >
                                Show more (+10) ...
                              </button>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                );
                })() : (
                  <div className="small" style={{ color: 'var(--muted)' }}>
                    Pipeline finished but no spikelets were scored in the crops.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {fhbFieldResult.excel_name && (
                    <a
                      className="btn soft"
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
          stomataParams={st}
          setStomataParams={setSt}
          isAuthenticated={!!user}
          onRequireLogin={() => {
            setAuthMode("login");
            setAuthStep("form");
            setAuthError("Please log in to continue with bulk processing.");
            setAuthModalOpen(true);
          }}
        />
      )}

          </div>
        </main>
      </div>

      {authModalOpen && (
        <div className="modal-overlay" onClick={() => setAuthModalOpen(false)}>
          <div className="modal-card modal-card--auth auth-card" onClick={(e) => e.stopPropagation()}>
            <button className="auth-close" type="button" onClick={() => setAuthModalOpen(false)} aria-label="Close">
              ×
            </button>
            <div className="auth-title">
              <span className="auth-kicker">WheatAI</span>
              <h2>
                {isRegister && authStep === "verify" ? "Verify email" : (isRegister ? "Create account" : "Welcome back")}
              </h2>
              <p className="auth-subtitle">
                {isRegister && authStep === "verify"
                  ? "Enter the OTP sent to your email."
                  : isRegister
                  ? "Create a user account to access bulk processing."
                  : "Sign in to access bulk processing."}
              </p>
            </div>
            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                className={`auth-tab ${!isRegister ? "active" : ""}`}
                type="button"
                onClick={() => { setAuthMode("login"); setAuthStep("form"); }}
              >
                Login
              </button>
              <button
                className={`auth-tab ${isRegister ? "active" : ""}`}
                type="button"
                onClick={() => { setAuthMode("register"); setAuthStep("form"); }}
              >
                Register
              </button>
            </div>
            {isRegister && authStep === "verify" ? (
              <form className="auth-form" onSubmit={handleVerify}>
                <label className="auth-label">Email</label>
                <div className="auth-field">
                  <span className="auth-icon" aria-hidden="true">✉</span>
                  <input
                    className="input input--auth"
                    type="email"
                    value={verifyEmailInput}
                    onChange={(e) => setVerifyEmailInput(e.target.value)}
                    required
                  />
                </div>
                <label className="auth-label">OTP Code</label>
                <div className="auth-field">
                  <span className="auth-icon" aria-hidden="true">🔐</span>
                  <input
                    className="input input--auth"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit code"
                    required
                  />
                </div>
                <div className="auth-actions">
                  <button className="btn" type="submit">Verify</button>
                  <button className="btn outline" type="button" onClick={handleResend}>Resend</button>
                </div>
                {authError && (
                  <p className="auth-error">{authError}</p>
                )}
              </form>
            ) : (
              <form className="auth-form" onSubmit={isRegister ? handleRegister : handleLogin}>
                {isRegister ? (
                  <>
                    <label className="auth-label">Email</label>
                    <div className="auth-field">
                      <span className="auth-icon" aria-hidden="true">✉</span>
                      <input
                        className="input input--auth"
                        type="email"
                        value={authForm.email}
                        onChange={(e) => setAuthForm((v) => ({ ...v, email: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="auth-grid">
                      <div className="auth-group">
                        <label className="auth-label">First name</label>
                        <div className="auth-field">
                          <span className="auth-icon" aria-hidden="true">👤</span>
                          <input
                            className="input input--auth"
                            value={authForm.firstName}
                            onChange={(e) => setAuthForm((v) => ({ ...v, firstName: e.target.value }))}
                            required
                          />
                        </div>
                      </div>
                      <div className="auth-group">
                        <label className="auth-label">Last name</label>
                        <div className="auth-field">
                          <span className="auth-icon" aria-hidden="true">👤</span>
                          <input
                            className="input input--auth"
                            value={authForm.lastName}
                            onChange={(e) => setAuthForm((v) => ({ ...v, lastName: e.target.value }))}
                            required
                          />
                        </div>
                      </div>
                      <div className="auth-group">
                        <label className="auth-label">Username</label>
                        <div className="auth-field">
                          <span className="auth-icon" aria-hidden="true">🏷</span>
                          <input
                            className="input input--auth"
                            value={authForm.username}
                            onChange={(e) => setAuthForm((v) => ({ ...v, username: e.target.value }))}
                            required
                          />
                        </div>
                      </div>
                      <div className="auth-group">
                        <label className="auth-label">Organization</label>
                        <div className="auth-field">
                          <span className="auth-icon" aria-hidden="true">🏢</span>
                          <input
                            className="input input--auth"
                            value={authForm.organization}
                            onChange={(e) => setAuthForm((v) => ({ ...v, organization: e.target.value }))}
                            required
                          />
                        </div>
                      </div>
                    </div>
                    <div className="auth-grid auth-grid--stack">
                      <div className="auth-group">
                        <label className="auth-label">Password</label>
                        <div className="auth-field">
                          <span className="auth-icon" aria-hidden="true">🔒</span>
                          <input
                            className="input input--auth"
                            type="password"
                            value={authForm.password}
                            onChange={(e) => setAuthForm((v) => ({ ...v, password: e.target.value }))}
                            required
                          />
                        </div>
                      </div>
                      <div className="auth-group">
                        <label className="auth-label">Confirm password</label>
                        <div className="auth-field">
                          <span className="auth-icon" aria-hidden="true">✅</span>
                          <input
                            className="input input--auth"
                            type="password"
                            value={authForm.confirmPassword}
                            onChange={(e) => setAuthForm((v) => ({ ...v, confirmPassword: e.target.value }))}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="auth-label">Username</label>
                    <div className="auth-field">
                      <span className="auth-icon" aria-hidden="true">👤</span>
                      <input
                        className="input input--auth"
                        value={authForm.username}
                        onChange={(e) => setAuthForm((v) => ({ ...v, username: e.target.value }))}
                        required
                      />
                    </div>
                    <label className="auth-label">Password</label>
                    <div className="auth-field">
                      <span className="auth-icon" aria-hidden="true">🔒</span>
                      <input
                        className="input input--auth"
                        type="password"
                        value={authForm.password}
                        onChange={(e) => setAuthForm((v) => ({ ...v, password: e.target.value }))}
                        required
                      />
                    </div>
                  </>
                )}
                {authError && (
                  <p className="auth-error">{authError}</p>
                )}
                <button className="btn auth-submit" type="submit">
                  {isRegister ? "Create account" : "Sign in"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />

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
