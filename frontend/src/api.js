// import axios from "axios";
// const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// export const runDetection = (formData) => {
//   return axios.post(`${API_URL}/api/detect/basic/`, formData, {
//     headers: { "Content-Type": "multipart/form-data" },
//   });
// };


// tiny helper for POSTing the image + confidence
export async function detectBasic({ file, confidence, apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000' }) {
  const fd = new FormData();
  fd.append('image', file);
  fd.append('confidence', String(confidence));

  const res = await fetch(`${apiBase}/api/detect/basic/`, {
    method: 'POST',
    body: fd,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Detection failed: ${res.status} ${txt}`);
  }
  return res.json();
}
