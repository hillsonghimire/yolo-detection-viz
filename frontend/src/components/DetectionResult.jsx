// import { useEffect, useRef } from "react";

// export default function DetectionResult({ file, results }) {
//   const canvasRef = useRef(null);

//   useEffect(() => {
//     if (!file || !results || results.length === 0) return;
//     const canvas = canvasRef.current;
//     const ctx = canvas.getContext("2d");
//     const img = new Image();
//     const url = URL.createObjectURL(file);

//     img.onload = () => {
//       canvas.width = img.width;
//       canvas.height = img.height;
//       ctx.drawImage(img, 0, 0);

//       ctx.lineWidth = 2;
//       ctx.font = "16px sans-serif";

//       results.forEach((box) => {
//         const label = `${box.class_name} (${(box.confidence*100).toFixed(0)}%)`;
//         if (box.bbox_xyxyxyxy) {
//           // OBB polygon
//           const pts = box.bbox_xyxyxyxy;
//           ctx.strokeStyle = "red";
//           ctx.beginPath();
//           ctx.moveTo(pts[0], pts[1]);
//           for (let i = 2; i < pts.length; i += 2) {
//             ctx.lineTo(pts[i], pts[i + 1]);
//           }
//           ctx.closePath();
//           ctx.stroke();

//           const lx = Math.min(pts[0], pts[2], pts[4], pts[6]);
//           const ly = Math.min(pts[1], pts[3], pts[5], pts[7]);
//           ctx.fillStyle = "rgba(255,255,0,0.7)";
//           ctx.fillRect(lx, ly - 18, ctx.measureText(label).width + 6, 18);
//           ctx.fillStyle = "black";
//           ctx.fillText(label, lx + 3, ly - 4);
//         } else if (box.bbox_xyxy) {
//           // Axis-aligned
//           const [x1, y1, x2, y2] = box.bbox_xyxy;
//           ctx.strokeStyle = "lime";
//           ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

//           ctx.fillStyle = "rgba(255,255,0,0.7)";
//           ctx.fillRect(x1, y1 - 18, ctx.measureText(label).width + 6, 18);
//           ctx.fillStyle = "black";
//           ctx.fillText(label, x1 + 3, y1 - 4);
//         }
//       });
//       URL.revokeObjectURL(url);
//     };
//     img.src = url;

//     return () => URL.revokeObjectURL(url);
//   }, [file, results]);

//   return (
//     <div style={{ marginTop: 12 }}>
//       <canvas ref={canvasRef} style={{ border: "1px solid #ddd", maxWidth: "100%" }} />
//     </div>
//   );
// }
