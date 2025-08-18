import React from "react";

export default function Controls({ threshold, setThreshold, showLabels, setShowLabels, lineWidth, setLineWidth }){
  return (
    <div>
      <div className="label">Confidence threshold: {threshold.toFixed(2)}</div>
      <input
        type="range" min="0" max="1" step="0.01"
        value={threshold}
        onChange={(e)=> setThreshold(parseFloat(e.target.value))}
      />
      <div className="row" style={{marginTop:8, alignItems:'center'}}>
        <div className="col toggle" style={{flex:'0 0 auto'}}>
          <input id="lbl" type="checkbox" checked={showLabels} onChange={e=> setShowLabels(e.target.checked)} />
          <label htmlFor="lbl" className="small">Show labels</label>
        </div>
        <div className="col" style={{flex:'0 0 240px'}}>
          <div className="label">Line width: {lineWidth}px</div>
          <input
            type="range" min="1" max="6" step="1"
            value={lineWidth}
            onChange={(e)=> setLineWidth(parseInt(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
