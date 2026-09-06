# BardomPro backend v3.0 — moved here from /backend/

The production backend code is here: `src/server.js`

## What it does

- Uses `z-ai-web-dev-sdk@0.0.18` natively (real Z.AI GLM-4-Plus, GLM-4V, image/video gen)
- Exposes 14 capabilities + social gallery
- Sandboxed Python execution (timeout 5s, no network)

## Endpoints (14 capabilities)

### Intelligence
- `POST /api/chat` — GLM-4-Plus text completion
- `POST /api/vision` — GLM-4V image understanding
- `POST/GET /api/p13n/user-context` — personalization
- `POST /api/maisa/support` ★ — Maisa support (optional)

### Media
- `POST /api/media/create-image` — image generation
- `POST /api/media/create-video` — video generation (async)
- `GET /api/media/create-video/result?id=...` — poll for video result
- `POST /api/media/animate-image` — image animation
- `POST /api/media/edit-image` — image editing (img2img)
- `POST /api/media/edit-video` — video editing
- `POST /api/media/get-audio` ★ — audio extraction (optional)
- `POST /api/media/get-reference-image` — reference image search

### Tools
- `POST /api/python-execution` — sandboxed Python
- `POST /api/container/python-execution` — container Python with files
- `POST /api/container/file-search` — file index search
- `POST /api/browser/search` — web search via Z.AI
- `POST /api/meta-1p/content-search` — Meta content search

### Social
- `POST /api/gallery/publish`
- `POST /api/gallery/:id/like`
- `GET /api/gallery`
- `DELETE /api/gallery/:id`

### System
- `GET /healthz`
- `GET /api/capabilities`

★ = optional capability

## Deploy to Render

1. Root Directory: `z-ai-web-dev-sdk/backend`
2. Build Command: `npm install`
3. Start Command: `node src/server.js`
4. Environment: `PORT` (auto-set by Render)
