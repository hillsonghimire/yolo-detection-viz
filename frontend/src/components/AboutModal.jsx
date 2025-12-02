import React from "react";

function initialsOf(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((n) => n[0].toUpperCase())
    .join("");
}

export default function AboutModal({ open, onClose, profiles }) {
  if (!open) return null;

  return (
    <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About WheatAI" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <header className="about-header">
          <div style={{ width: "100%", textAlign: "center" }}>
            <h3>Meet the team</h3>
          </div>
          <button className="about-close" type="button" onClick={onClose} aria-label="Close About WheatAI panel">
            ✕
          </button>
        </header>

        <div className="about-list">
          {profiles.map((p, idx) => (
            <article className="about-row" key={`${p.name}-${idx}`}>
              {p.image ? (
                <div className="about-avatar about-avatar--large about-avatar--image">
                  <img src={p.image} alt={p.name} />
                </div>
              ) : (
                <div className="about-avatar about-avatar--large">
                  <span>{initialsOf(p.name)}</span>
                </div>
              )}
              <div className="about-body">
                <div className="about-title">
                  <div className="about-name">{p.name}</div>
                  <div className="about-role">{p.title}</div>
                  {p.department ? <div className="about-dept">{p.department}</div> : null}
                  {p.affiliation ? <div className="about-affil">{p.affiliation}</div> : null}
                </div>
                <p className="about-summary">{p.summary}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
