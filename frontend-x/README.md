# OBB Frontend (React + Vite)

Client-side OBB (oriented bounding box) overlay with a **live confidence slider** that does **not** re-request the backend.

## Quick start
```bash
npm i
npm run dev
# open the printed URL (default http://localhost:5173)
```

Set your backend endpoint in `.env`:
```
VITE_API_BASE=http://localhost:8000
```
The frontend will make **one** POST request to `${VITE_API_BASE}/api/detect/basic/` when you click **Run detection**. It sends a low `conf` (0.05) so the server returns the **full set** of detections. From then on, changing the slider filters the results **entirely in the browser**.

## Expected backend response
Flexible: we try to normalize several common formats. Ideally return:
```json
{
  "image_width": 4032,
  "image_height": 3024,
  "detections": [
    {"class":"spike","class_id":0,"confidence":0.82,"poly":[x1,y1,x2,y2,x3,y3,x4,y4]}
  ]
}
```
If your backend returns `obb: {x,y,w,h,angle}` or `box:{x1,y1,x2,y2}`, we convert to a polygon automatically.

## Notes
- Slider moves **never** call the backend again.
- You can toggle labels and adjust line width.
- If your backend already applies a confidence filter, set it low (e.g., 0.05) to enable rich client-side filtering.
