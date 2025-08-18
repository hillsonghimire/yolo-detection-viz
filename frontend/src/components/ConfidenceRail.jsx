export default function ConfidenceRail({ value, onChange }){
  return (
    <div className="slider-rail">
      <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:6}}>
        <label className="small" style={{writingMode:"vertical-rl", transform:"rotate(180deg)"}}>
          Confidence
        </label>
        <input
          className="slider-v"
          type="range" min="0" max="1" step="0.01"
          value={value}
          onChange={(e)=> onChange(parseFloat(e.target.value))}
        />
        <div className="badge">{value.toFixed(2)}</div>
      </div>
    </div>
  );
}
