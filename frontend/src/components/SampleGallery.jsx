// Replace these URLs with your real samples placed in /public/samples/...
const samples = {
  spike: [
    "/samples/spike/spike1.png",
    "/samples/spike/spike2.jpg",
    "/samples/spike/spike3.jpg",
    "/samples/spike/spike4.jpg",
  ],
  spikelet: [
    "/samples/spikelet/spikelet1.JPG",
    "/samples/spikelet/spikelet2.PNG",
    "/samples/spikelet/spikelet3.PNG",
    "/samples/spikelet/spikelet4.JPG",
  ],
  third: [
    "/samples/third/third-1.jpg",
    "/samples/third/third-2.jpg",
    "/samples/third/third-3.jpg",
    "/samples/third/third-4.jpg",
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
      <h4>Try with sample images</h4>
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
