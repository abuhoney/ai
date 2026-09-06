# z-ai-web-dev-sdk folder (v3.0.0)

This folder contains the complete `z-ai-web-dev-sdk` package with **14 capabilities** ready for use via an Android APK or web browser.

## Contents

- **dist/** — The official SDK JavaScript files (v0.0.18)
- **backend/** — Node.js/Express backend with all 14 endpoints (`src/server.js`)
- **web-app/** — Web UI (HTML + JS + CSS) with Dark Glassmorphism design
- **android/** — Android project source code (Java)
- **assets/** — App icons and resources
- **.z-ai-config** — SDK configuration with user ID `ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90`
- **README.md** — Full documentation

## User ID

All configurations use the user ID: **`ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90`**

## How It Works

1. The APK embeds the web-app directly in `assets/web/` (offline-capable shell)
2. On launch, the WebView loads `file:///android_asset/web/index.html`
3. The web app calls the BardomPro backend (`https://bardom.onrender.com` by default)
4. The backend uses `z-ai-web-dev-sdk` to call Z.AI APIs (GLM-4-Plus, GLM-4V, image gen, etc.)
5. The user ID is passed to the web app via JavaScript interface `AndroidBridge`

## 14 Capabilities (v3)

### Intelligence (3+1 optional)
- `chat` — GLM-4-Plus text completion
- `vision` — GLM-4V image understanding
- `p13n_tool.get_user_context` — personalization
- `maisa_support_axon` ★ — Maisa support (optional)

### Media (7+1 optional)
- `media.create_image` — image generation
- `media.create_video` — video generation (async)
- `media.animate_image` — image animation
- `media.edit_image` — image editing (img2img)
- `media.edit_video` — video editing
- `media.get_audio` ★ — audio extraction (optional)
- `media.get_reference_image` — image search for references

### Tools (5)
- `python_execution` — sandboxed Python (timeout 5s, no network)
- `container.python_execution` — Python in ephemeral container with files
- `container.file_search` — file index search
- `browser.search` — web search via Z.AI
- `meta_1p.content_search` — Meta first-party content search

★ = optional capability

## Quick Build

```bash
cd android
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
# Rename to BardomPro-AI-v3.apk
```

## Quick Backend

```bash
cd backend
npm install
PORT=3000 node src/server.js
```

## Quick Web Preview

Just open `web-app/index.html` in any modern browser.
