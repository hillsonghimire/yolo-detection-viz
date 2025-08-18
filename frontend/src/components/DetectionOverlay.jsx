// import React from "react";

// export default function DetectionOverlay({
//   boxes = [],
//   imgNaturalWidth,
//   imgNaturalHeight,
//   displayedWidth,
//   displayedHeight,
//   minConfidence = 0,
//   showLabels = true,
// }) {
//   if (
//     !imgNaturalWidth ||
//     !imgNaturalHeight ||
//     !displayedWidth ||
//     !displayedHeight
//   ) {
//     return null;
//   }

//   const sx = displayedWidth / imgNaturalWidth;
//   const sy = displayedHeight / imgNaturalHeight;

//   const filtered = boxes.filter((b) => (b?.confidence ?? 0) >= minConfidence);

//   const scalePts = (pts) => {
//     // pts: [x1,y1,x2,y2,x3,y3,x4,y4]
//     const out = [];
//     for (let i = 0; i < pts.length; i += 2) {
//       out.push([pts[i] * sx, pts[i + 1] * sy]);
//     }
//     return out;
//   };

//   const aabbFromPts = (pts) => {
//     const xs = pts.filter((_, i) => i % 2 === 0);
//     const ys = pts.filter((_, i) => i % 2 === 1);
//     const x1 = Math.min(...xs),
//       x2 = Math.max(...xs),
//       y1 = Math.min(...ys),
//       y2 = Math.max(...ys);
//     return { x: x1 * sx, y: y1 * sy, w: (x2 - x1) * sx, h: (y2 - y1) * sy };
//   };

//   return (
//     <svg
//       width={displayedWidth}
//       height={displayedHeight}
//       viewBox={`0 0 ${displayedWidth} ${displayedHeight}`}
//       className="absolute inset-0 pointer-events-none"
//     >
//       {filtered.map((b, i) => {
//         // prefer OBB polygon
//         const polyRaw =
//           b.polygon || b.bbox_xyxyxyxy || b.poly || b.points || null;

//         if (Array.isArray(polyRaw) && polyRaw.length === 8) {
//           const pts = scalePts(polyRaw);
//           const pointsAttr = pts.map(([x, y]) => `${x},${y}`).join(" ");
//           // label position: top-left of polygon AABB
//           const { x, y, w } = aabbFromPts(polyRaw);

//           return (
//             <g key={i}>
//               <polygon
//                 points={pointsAttr}
//                 fill="none"
//                 stroke="lime"
//                 strokeWidth="2"
//               />
//               {showLabels && (
//                 <g>
//                   <rect
//                     x={x}
//                     y={Math.max(0, y - 20)}
//                     width={Math.max(40, (b.class || "").length * 7 + 50)}
//                     height="20"
//                     fill="black"
//                     opacity="0.6"
//                   />
//                   <text x={x + 6} y={Math.max(12, y - 6)} fontSize="12" fill="white">
//                     {(b.class || "") +
//                       " " +
//                       ((b.confidence || 0) * 100).toFixed(1) +
//                       "%"}
//                   </text>
//                 </g>
//               )}
//             </g>
//           );
//         }

//         // fallback: AABB if polygon not provided
//         const x = (b.x1 ?? 0) * sx;
//         const y = (b.y1 ?? 0) * sy;
//         const w = ((b.x2 ?? 0) - (b.x1 ?? 0)) * sx;
//         const h = ((b.y2 ?? 0) - (b.y1 ?? 0)) * sy;

//         return (
//           <g key={i}>
//             <rect
//               x={x}
//               y={y}
//               width={w}
//               height={h}
//               fill="none"
//               stroke="lime"
//               strokeWidth="2"
//             />
//             {showLabels && (
//               <g>
//                 <rect
//                   x={x}
//                   y={Math.max(0, y - 20)}
//                   width={Math.max(40, (b.class || "").length * 7 + 50)}
//                   height="20"
//                   fill="black"
//                   opacity="0.6"
//                 />
//                 <text x={x + 6} y={Math.max(12, y - 6)} fontSize="12" fill="white">
//                   {(b.class || "") +
//                     " " +
//                     ((b.confidence || 0) * 100).toFixed(1) +
//                     "%"}
//                 </text>
//               </g>
//             )}
//           </g>
//         );
//       })}
//     </svg>
//   );
// }
