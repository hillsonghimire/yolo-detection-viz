import React from "react";

export default function AboutModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About WheatAI" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" type="button" onClick={onClose} aria-label="Close About WheatAI panel">
          ✕
        </button>
        <div className="about-simple">
          <img className="about-image" src="/media/test-breeding.jpg" alt="About WheatAI" />
          <h2 className="about-heading">About us</h2>
          <div className="about-copy">
            <p>
              WheatAI (Version 1.0) is a cloud-based digital tool designed to support high-throughput wheat phenotyping and precision breeding. The platform provides automated detection and counting of wheat heads, spikelets, and kernels from close-range images, as well as assessment of Fusarium head blight (FHB) severity and Fusarium-damaged kernels (FDK).
            </p>
            <p>
              These capabilities help researchers, breeders and farmers rapidly extract quantitative traits from field and lab images, improving the efficiency, consistency, and scalability of wheat phenotyping. WheatAI is a collaborative effort of the Remote Sensing & Agricultural Intelligence (RSAI) Lab (PI: Dr. Maitiniyazi Maimaitijiang, Assistant Professor) and the Winter Wheat Breeding and Innovation Lab (PI: Dr. Sunish Kumar Sehgal, Professor) at South Dakota State University, with important contributions from graduate students including Hillson Ghimire and Subash Thapa.
            </p>
            <p>
              Development of WheatAI Version 1.0 has been supported by the South Dakota Wheat Commission, USDA Wheat CAP, South Dakota Nutrient Research and Education Council (NREC), and the South Dakota Agricultural Experiment Station (AES).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
