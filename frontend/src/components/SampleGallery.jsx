// Replace these URLs with your real samples placed in /public/samples/...
const samples = {
  spike: [
    "/samples/spike/spike1.jpg",
    "/samples/spike/spike2.jpg",
    "/samples/spike/spike3.jpg",
    "/samples/spike/spike4.jpg",
    "/samples/spike/spike5.jpg",
    "/samples/spike/spike6.jpg",
    "/samples/spike/spike7.jpg",
    // "/samples/spike/spike8.jpg",
    // "/samples/spike/spike9.png",
    // "/samples/spike/spike10.jpg",
  ],
  spikelet: [
    "/samples/spikelet/spikelet1.jpg",
    "/samples/spikelet/spikelet2.PNG",
    "/samples/spikelet/spikelet3.PNG",
    "/samples/spikelet/spikelet4.JPG",
    "/samples/spikelet/spikelet5.PNG",
    "/samples/spikelet/spikelet6.PNG",
    "/samples/spikelet/spikelet7.JPG",
    "/samples/spikelet/spikelet7.png",
    // "/samples/spikelet/spikelet8.JPG",
    "/samples/spikelet/spikelet9.jpg",
    "/samples/spikelet/spikelet10.png",
    "/samples/spikelet/spikelet11.png",
    "/samples/spikelet/spikelet12.png",
  ],
  fhb: [
    "/samples/fhb/fhb1.JPG",
    "/samples/fhb/fhb8.JPG",
    "/samples/fhb/fhb3.jpg",
    "/samples/fhb/fhb4.jpg",
    "/samples/fhb/fhb5.jpg",
    "/samples/fhb/fhb6.JPG",
    "/samples/fhb/fhb2.jpg",
    "/samples/fhb/fhb7.JPG",
    "/samples/fhb/fhb8.JPG",
    "/samples/fhb/fhb9.JPG",
    "/samples/fhb/fhb10.JPG",
    // "/samples/fhb/fhb11.JPG",
    // "/samples/fhb/fhb12.JPG",
    // "/samples/fhb/fhb13.JPG",
    ,
  ],
  fdk: [
    "/samples/fdk/fdk1.JPG",
    "/samples/fdk/fdk2.JPG",
    "/samples/fdk/fdk3.JPG",
    "/samples/fdk/fdk4.JPG",
    "/samples/fdk/fdk5.JPG",
    "/samples/fdk/fdk6.JPG",
    "/samples/fdk/fdk7.jpg",
    "/samples/fdk/fdk8.JPG",
    "/samples/fdk/fdk9.JPG",
    // "/samples/fdk/fdk10.JPG",
  ],
};

export default function SampleGallery({ model, onPick }){
  const imgs = samples[model] || [];
  const handleDragStart = (e, url)=>{
    e.dataTransfer.setData("text/uri-list", url);
    e.dataTransfer.setData("text/plain", url);
  };
  return (
    <div className="gallery card">
      {/* <h4>Try with sample images</h4> */}
      <div className="thumbs">
        {imgs.map((url,idx)=> (
          <div key={idx} className="thumb"
            draggable onDragStart={(e)=> handleDragStart(e,url)}
            onClick={()=> onPick(url)}>
            <img src={url} alt={`sample-${idx+1}`} />
          </div>
        ))}
      </div>
      <div className="small" style={{marginTop:6}}>
        Click to load, or drag onto the left panel.
      </div>
    </div>
  );
}
