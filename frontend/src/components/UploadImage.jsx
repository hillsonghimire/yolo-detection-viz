// export default function UploadImage({ file, setFile, onProcess, loading }) {
//   return (
//     <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
//       <input
//         type="file"
//         accept="image/*"
//         onChange={(e) => setFile(e.target.files?.[0] || null)}
//       />
//       <button onClick={onProcess} disabled={!file || loading}>
//         {loading ? "Processing..." : "Start Processing"}
//       </button>
//       {file && (
//         <div style={{ marginLeft: 12, fontSize: 12, color: "#666" }}>
//           Selected: {file.name}
//         </div>
//       )}
//     </div>
//   );
// }
