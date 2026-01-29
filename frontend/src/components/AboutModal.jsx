import React from "react";

export default function AboutModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About WheatAI" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" type="button" onClick={onClose} aria-label="Close About WheatAI panel">
          ✕
        </button>
        <div className="about-hero">
          <span className="about-kicker">About WheatAI</span>
          <h2>AI-based Wheat Phenotyping Platform</h2>
          <p>
            WheatAI (Version 1.0) is a cloud-based digital tool designed to support high-throughput wheat phenotyping and precision breeding.
          </p>
        </div>
        <div className="about-panels">
          <section className="about-panel">
            <h3>What it does</h3>
            <ul>
              <li>Automated detection and counting of wheat heads, spikelets, and kernels.</li>
              <li>Fusarium head blight (FHB) severity assessment.</li>
              <li>Fusarium-damaged kernels (FDK) detection for quality screening.</li>
              <li>Rapid, consistent trait extraction from field and lab imagery.</li>
            </ul>
          </section>
          <section className="about-panel">
            <h3>Who built it</h3>
            <p>
              WheatAI is a collaborative effort of the Remote Sensing & Agricultural Intelligence (RSAI) Lab (PI: Dr. Maitiniyazi Maimaitijiang, Assistant Professor) and the Winter Wheat Breeding and Innovation Lab (PI: Dr. Sunish Kumar Sehgal, Professor) at South Dakota State University, with important contributions from graduate students including Hillson Ghimire and Subash Thapa.
            </p>
          </section>
          <section className="about-panel">
            <h3>Support</h3>
            <p>
              Development of WheatAI Version 1.0 has been supported by the South Dakota Wheat Commission, USDA Wheat CAP, South Dakota Nutrient Research and Education Council (NREC), and the South Dakota Agricultural Experiment Station (AES).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
