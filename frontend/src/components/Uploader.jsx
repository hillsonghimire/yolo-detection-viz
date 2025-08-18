import React, { useRef } from "react";

export default function Uploader({ onFile }){
  const ref = useRef(null);

  return (
    <div className="row" style={{alignItems:'center'}}>
      <div className="col" style={{flex:'0 0 auto'}}>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          onChange={(e)=> onFile(e.target.files?.[0] || null)}
        />
      </div>
      <div className="col small">
        <p style={{margin:'6px 0 0 0'}}>
          Choose an image, then click <b>Run detection</b>. We will make <i>one</i> request to the backend.
          Move the slider later to filter detections instantly without re-requesting.
        </p>
      </div>
    </div>
  );
}
