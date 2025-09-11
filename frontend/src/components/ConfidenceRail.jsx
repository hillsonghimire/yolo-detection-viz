export default function ConfidenceRail({ value, onChange }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0)) * 100;
  return (
    <div className="hslider" role="group" aria-label="Confidence threshold">
      <div className="hslider-label">Confidence</div>
      <input
        className="hslider-input modern-hslider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--pct": `${pct}%` }}
      />
      <div className="hslider-value" aria-live="polite">{value.toFixed(2)}</div>
    </div>
  );
}
