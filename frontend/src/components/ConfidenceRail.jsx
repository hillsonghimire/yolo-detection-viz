export default function ConfidenceRail({ value, onChange }) {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const pct = clamp01(value) * 100;
  const onNumChange = (e) => onChange(clamp01(e.target.value));

  return (
    <div className="hslider" role="group" aria-label="Confidence threshold">
      <div className="hslider-label" title="Filter out detections below this confidence">Confidence</div>
      <input
        className="hslider-input modern-hslider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        list="conf-ticks"
        value={clamp01(value)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--pct": `${pct}%` }}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamp01(value)}
      />
      <datalist id="conf-ticks">
        <option value="0" />
        <option value="0.25" />
        <option value="0.5" />
        <option value="0.75" />
        <option value="1" />
      </datalist>
      <div className="hslider-value" title={`${Math.round(pct)}%`} aria-live="polite">{value.toFixed(2)}</div>
      <input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={clamp01(value)}
        onChange={onNumChange}
        style={{ width: 72, marginLeft: 8, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--fg)' }}
        aria-label="Confidence value"
      />
    </div>
  );
}
