// Replace these URLs with your real samples placed in /public/samples/...
const fhbSamples = [
  "/samples/fhb/fhb1.JPG",
  "/samples/fhb/fhb8.JPG",
  "/samples/fhb/fhb3.jpg",
  "/samples/fhb/fhb5.jpg",
  "/samples/fhb/fhb6.JPG",
  "/samples/fhb/fhb2.jpg",
  "/samples/fhb/fhb10.JPG",
];

const fhbFieldSamples = [
  "/samples/fhb-field/KSU1.JPG",
  "/samples/fhb-field/KSU2.JPG",
  "/samples/fhb-field/sdsu3.jpg",
  "/samples/fhb-field/KSU4.JPG",
  "/samples/fhb-field/sdsu11.JPG",
];

const samples = {
  spike: [
    "/samples/spike/spike1.jpg",
    "/samples/spike/spike2.jpg",
    // "/samples/spike/spike3.jpg",
    "/samples/spike/spike4.jpg",
    // "/samples/spike/spike5.jpg",
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
    // "/samples/spikelet/spikelet4.JPG",
    "/samples/spikelet/spikelet5.PNG",
    "/samples/spikelet/spikelet6.PNG",
    "/samples/spikelet/spikelet7.JPG",
    "/samples/spikelet/spikelet7.png",
    // "/samples/spikelet/spikelet8.JPG",
    "/samples/spikelet/spikelet9.jpg",
    // "/samples/spikelet/spikelet10.png",
    // "/samples/spikelet/spikelet11.png",
    // "/samples/spikelet/spikelet12.png",
  ],
  kernel_count_on_spike: [
    "/samples/WheatKernelonSpikeImage/kernelSpike1.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike2.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike3.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike4.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike5.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike6.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike7.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike8.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike9.png",
    "/samples/WheatKernelonSpikeImage/kernelSpike10.png",
  ],
  uav_spike: [
    "/samples/uav-spike/sample1.png",
    "/samples/uav-spike/sample2.png",
    "/samples/uav-spike/sample3.png",
    "/samples/uav-spike/sample4.png",
    "/samples/uav-spike/sample5.png",
  ],
  stomata: [
    { file: "/samples/stomata/Stomata1.tif", thumb: "/samples/stomata/Stomata1.jpg" },
    { file: "/samples/stomata/Stomata8.tif", thumb: "/samples/stomata/Stomata8.jpg" },
    { file: "/samples/stomata/Stomata17.tif", thumb: "/samples/stomata/Stomata17.jpg" },
    { file: "/samples/stomata/Stomata45.tif", thumb: "/samples/stomata/Stomata45.jpg" },
    { file: "/samples/stomata/Stomata89.tif", thumb: "/samples/stomata/Stomata89.jpg" },
  ],
  fhb: fhbSamples,
  fhb_field: fhbFieldSamples,
  fdk: [
    "/samples/fdk/fdk1.JPG",
    "/samples/fdk/fdk2.JPG",
    "/samples/fdk/fdk3.JPG",
    "/samples/fdk/fdk4.JPG",
    // "/samples/fdk/fdk5.JPG",
    // "/samples/fdk/fdk6.JPG",
    "/samples/fdk/fdk7.jpg",
    "/samples/fdk/fdk8.JPG",
    "/samples/fdk/fdk9.JPG",
    // "/samples/fdk/fdk10.JPG",
  ],
  kernel: [
    "/samples/kernel/kernel10.JPG",
    "/samples/kernel/kernel12.JPG",
    "/samples/kernel/kernel9.JPG",
    "/samples/kernel/kernel4.jpg",
    "/samples/kernel/kernel12.JPG",
    "/samples/kernel/kernel6.jpg",
    "/samples/kernel/kernel1.jpg",
  ],
};

export default function SampleGallery({ model, onPick }){
  const imgs = samples[model] || [];
  const resolveItem = (item) => {
    if (item && typeof item === "object") {
      const file = item.file || item.url || "";
      const thumb = item.thumb || item.preview || file;
      return { file, thumb };
    }
    return { file: item, thumb: item };
  };
  const handleDragStart = (e, url)=>{
    e.dataTransfer.setData("text/uri-list", url);
    e.dataTransfer.setData("text/plain", url);
  };
  return (
    <div className="gallery card">
      {/* <h4>Try with sample images</h4> */}
      <div className="thumbs">
        {imgs.map((item,idx)=> {
          const { file, thumb } = resolveItem(item);
          return (
            <div key={idx} className="thumb"
              draggable onDragStart={(e)=> handleDragStart(e, file)}
              onClick={()=> onPick(file, thumb)}>
              <img src={thumb} alt={`sample-${idx+1}`} />
            </div>
          );
        })}
      </div>
      {/* Helper text removed to allow thumbnails to use space */}
    </div>
  );
}
