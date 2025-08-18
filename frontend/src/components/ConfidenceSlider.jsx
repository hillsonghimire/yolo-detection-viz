// export default function ConfidenceSlider({ confidence, setConfidence, onReRun }) {
//   return (
//     <div style={{ margin: "12px 0" }}>
//       <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
//         Confidence: {confidence.toFixed(2)}
//       </label>
//       <input
//         type="range"
//         min="0.1"
//         max="0.9"
//         step="0.05"
//         value={confidence}
//         onChange={(e) => setConfidence(parseFloat(e.target.value))}
//         style={{ width: "100%" }}
//       />
//       <div style={{ marginTop: 8 }}>
//         <button onClick={onReRun}>Re-run with confidence</button>
//       </div>
//     </div>
//   );
// }
