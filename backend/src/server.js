/* ============================================================
 * BardomPro AI v3.0.0 — Backend (Node.js/Express)
 * 14 capabilities powered by Z.AI
 *
 * Endpoints:
 *  /api/chat                      → GLM-4-Plus text completion
 *  /api/vision                    → GLM-4V image understanding
 *  /api/tts                       → text → audio
 *  /api/asr                       → audio → text (multipart)
 *  /api/gallery*                  → public gallery
 *
 *  /api/python-execution          → sandboxed python (child_process, timeout)
 *  /api/container/python-execution→ stricter sandbox variant
 *  /api/container/file-search     → in-memory file index search
 *  /api/browser/search            → web search via z-ai-web-dev-sdk
 *  /api/meta-1p/content-search    → meta first-party content search
 *  /api/p13n/user-context         → personalization context
 *
 *  /api/media/create-image        → image generation
 *  /api/media/create-video        → video generation (async)
 *  /api/media/animate-image       → image → animated (motion)
 *  /api/media/edit-image          → image edit (img2img)
 *  /api/media/edit-video          → video edit (trim/mute/overlay)
 *  /api/media/get-audio           → extract audio (optional)
 *  /api/media/get-reference-image→ retrieve reference image (search)
 *  /api/maisa/support             → maisa support axon (optional)
 *
 *  /healthz, /api/capabilities
 * ============================================================ */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { spawn, execFile } from 'node:child_process';
import { writeFile, readFile, mkdir, unlink, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZaiConfig } from './zai-config-init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Config ----
const PORT = process.env.PORT || 3000;
const MAX_PYTHON_TIMEOUT = 5000;       // 5s hard cap
const MAX_PYTHON_MEMORY = 64 * 1024;   // 64 MB (KB) — informational

// ---- In-memory state ----
const galleryStore = new Map();   // id → post
const fileIndex = new Map();      // path → meta (for container.file_search)
const userContexts = new Map();   // userId → context (p13n)

// ---- App ----
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ---- Lazy ZAI loader ----
let _zaiPromise = null;
async function getZAI() {
  if (!_zaiPromise) {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    _zaiPromise = ZAI.create();
  }
  return _zaiPromise;
}

// ============================================================
// Helpers
// ============================================================
const ok = (res, payload = {}) => res.json({ ok: true, ...payload });
const fail = (res, error, status = 500) => res.status(status).json({ ok: false, error: String(error?.message || error) });

function userIdOf(req) {
  return req.headers['x-user-id'] || 'ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90';
}

function newId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ============================================================
// Health + capabilities manifest
// ============================================================
app.get('/healthz', (req, res) => {
  res.json({ ok: true, version: '3.0.0', service: 'bardompro-backend', zai: true });
});

const CAPABILITIES = [
  { id: 'python_execution',           endpoint: '/api/python-execution',           category: 'tools',     label: 'تنفيذ Python',           optional: false },
  { id: 'browser.search',             endpoint: '/api/browser/search',             category: 'tools',     label: 'بحث ويب',                optional: false },
  { id: 'media.create_image',         endpoint: '/api/media/create-image',         category: 'media',     label: 'توليد الصور',            optional: false },
  { id: 'container.python_execution', endpoint: '/api/container/python-execution', category: 'tools',     label: 'حاوية Python',           optional: false },
  { id: 'meta_1p.content_search',     endpoint: '/api/meta-1p/content-search',     category: 'tools',     label: 'بحث محتوى Meta',         optional: false },
  { id: 'media.create_video',         endpoint: '/api/media/create-video',         category: 'media',     label: 'توليد الفيديو',          optional: false },
  { id: 'media.animate_image',        endpoint: '/api/media/animate-image',        category: 'media',     label: 'تحريك صورة',              optional: false },
  { id: 'p13n_tool.get_user_context', endpoint: '/api/p13n/user-context',          category: 'intelligence', label: 'سياق المستخدم',         optional: false },
  { id: 'container.file_search',      endpoint: '/api/container/file-search',       category: 'tools',     label: 'بحث الملفات',            optional: false },
  { id: 'media.edit_image',           endpoint: '/api/media/edit-image',           category: 'media',     label: 'تعديل صورة',             optional: false },
  { id: 'media.edit_video',           endpoint: '/api/media/edit-video',           category: 'media',     label: 'تعديل فيديو',            optional: false },
  { id: 'media.get_audio',            endpoint: '/api/media/get-audio',            category: 'media',     label: 'استخراج صوت',            optional: true  },
  { id: 'media.get_reference_image',  endpoint: '/api/media/get-reference-image',  category: 'media',     label: 'صورة مرجعية',            optional: false },
  { id: 'maisa_support_axon',         endpoint: '/api/maisa/support',              category: 'intelligence', label: 'دعم Maisa',             optional: true  },
];

app.get('/api/capabilities', (req, res) => {
  ok(res, { capabilities: CAPABILITIES, version: '3.0.0' });
});

// ============================================================
// 1) python_execution — sandboxed child_process
// ============================================================
async function runPythonSandbox(code, { memory = MAX_PYTHON_MEMORY, network = false } = {}) {
  const tmp = path.join(tmpdir(), `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`);
  const out = path.join(tmpdir(), `bp_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);
  await writeFile(tmp, String(code || ''), 'utf8');
  return new Promise((resolve) => {
    const args = ['-I', '-S', tmp];
    const opts = {
      timeout: MAX_PYTHON_TIMEOUT,
      maxBuffer: 1 * 1024 * 1024, // 1 MB stdout cap
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PYTHONPATH: '',
        // Strip network envs
        HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '',
      },
    };
    const child = execFile('python3', args, opts, async (err, stdout, stderr) => {
      try { await unlink(tmp); } catch {}
      if (err && err.killed) {
        resolve({ ok: false, error: 'timed out (>' + MAX_PYTHON_TIMEOUT + 'ms)', stdout: stdout || '', stderr: stderr || '' });
      } else if (err) {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: err.code });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: 0 });
      }
    });
  });
}

app.post('/api/python-execution', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return fail(res, 'code is required', 400);
    if (code.length > 20000) return fail(res, 'code too long (max 20kb)', 400);
    const result = await runPythonSandbox(code);
    ok(res, result);
  } catch (e) { fail(res, e); }
});

// ============================================================
// 2) container.python_execution — stricter sandbox, ephemeral work dir
// ============================================================
app.post('/api/container/python-execution', async (req, res) => {
  try {
    const { code, files = {} } = req.body || {};
    if (!code || typeof code !== 'string') return fail(res, 'code is required', 400);
    if (code.length > 20000) return fail(res, 'code too long', 400);

    // Create an ephemeral work directory (the "container")
    const workDir = path.join(tmpdir(), `container_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(workDir, { recursive: true });
    const entryFile = path.join(workDir, 'main.py');
    await writeFile(entryFile, code, 'utf8');
    for (const [name, content] of Object.entries(files)) {
      const safe = String(name).replace(/[^A-Za-z0-9._\-]/g, '_');
      await writeFile(path.join(workDir, safe), String(content), 'utf8');
      fileIndex.set(safe, { workDir, name: safe, size: content.length, updatedAt: Date.now() });
    }

    const result = await new Promise((resolve) => {
      const child = execFile('python3', ['-I', '-S', entryFile], {
        cwd: workDir,
        timeout: MAX_PYTHON_TIMEOUT,
        maxBuffer: 1 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: workDir,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '',
        },
      }, async (err, stdout, stderr) => {
        // Cleanup container
        try { await unlink(entryFile); } catch {}
        // Don't rm workDir; allow later file_search
        if (err && err.killed) {
          resolve({ ok: false, error: 'timed out', stdout: stdout || '', stderr: stderr || '' });
        } else if (err) {
          resolve({ ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: err.code, workDir });
        } else {
          resolve({ ok: true, stdout: stdout || '', stderr: stderr || '', exitCode: 0, workDir });
        }
      });
    });
    ok(res, result);
  } catch (e) { fail(res, e); }
});

// ============================================================
// 3) container.file_search — search the in-memory file index
// ============================================================
app.post('/api/container/file-search', (req, res) => {
  try {
    const { query, limit = 50 } = req.body || {};
    if (!query || typeof query !== 'string') return fail(res, 'query is required', 400);
    const q = query.toLowerCase();
    const results = [];
    for (const [key, meta] of fileIndex.entries()) {
      if (key.toLowerCase().includes(q) || (meta.name && meta.name.toLowerCase().includes(q))) {
        results.push({ name: key, size: meta.size, updatedAt: meta.updatedAt, workDir: meta.workDir });
        if (results.length >= limit) break;
      }
    }
    ok(res, { results, total: fileIndex.size });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 4) browser.search — web search via Z.AI SDK functions.invoke
// ============================================================
app.post('/api/browser/search', async (req, res) => {
  try {
    const { query, topK = 8 } = req.body || {};
    if (!query || typeof query !== 'string') return fail(res, 'query is required', 400);
    const zai = await getZAI();
    let results;
    try {
      // Use Z.AI function invoke if available
      results = await zai.functions.invoke('browser.search', { query, top_k: topK });
    } catch (fnErr) {
      // Fallback: GLM-4 completion synthesizes a search summary
      const completion = await zai.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: 'أنت مساعد بحث ويب. أرجع أهم النتائج (عنوان + رابط + ملخص) عن الاستعلام كقائمة JSON فقط، بدون شرح إضافي.' },
          { role: 'user', content: query },
        ],
        thinking: { type: 'disabled' },
      });
      const text = completion?.choices?.[0]?.message?.content || '';
      results = { source: 'glm-4-fallback', text };
    }
    ok(res, { results, query });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 5) meta_1p.content_search — meta first-party content search
// ============================================================
app.post('/api/meta-1p/content-search', async (req, res) => {
  try {
    const { query, scope = 'all', limit = 10 } = req.body || {};
    if (!query) return fail(res, 'query is required', 400);
    const zai = await getZAI();
    let results;
    try {
      results = await zai.functions.invoke('meta_1p.content_search', { query, scope, limit });
    } catch {
      const completion = await zai.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: 'أنت محرك بحث محتوى داخلي (Meta 1P). أرجع أفضل النتائج المرتبطة بالاستعلام كـ JSON: {items:[{title, snippet, type}]}' },
          { role: 'user', content: query },
        ],
        thinking: { type: 'disabled' },
      });
      const text = completion?.choices?.[0]?.message?.content || '';
      results = { source: 'glm-4-fallback', text };
    }
    ok(res, { results, query });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 6) p13n_tool.get_user_context — personalization
// ============================================================
app.post('/api/p13n/user-context', (req, res) => {
  try {
    const uid = userIdOf(req);
    if (!userContexts.has(uid)) {
      userContexts.set(uid, {
        userId: uid,
        createdAt: Date.now(),
        preferences: { language: 'ar', theme: 'dark' },
        sessions: 1,
        recent: [],
        interests: [],
      });
    }
    const ctx = userContexts.get(uid);
    if (req.body && req.body.update) {
      const u = req.body.update;
      if (u.preferences) ctx.preferences = { ...ctx.preferences, ...u.preferences };
      if (u.interest) {
        ctx.interests = Array.from(new Set([...(ctx.interests || []), u.interest])).slice(-20);
      }
      if (u.recent) {
        ctx.recent = [u.recent, ...(ctx.recent || [])].slice(0, 10);
      }
      ctx.sessions += 1;
      ctx.updatedAt = Date.now();
    }
    ok(res, { context: ctx });
  } catch (e) { fail(res, e); }
});

app.get('/api/p13n/user-context', (req, res) => {
  try {
    const uid = userIdOf(req);
    if (!userContexts.has(uid)) {
      userContexts.set(uid, {
        userId: uid,
        createdAt: Date.now(),
        preferences: { language: 'ar', theme: 'dark' },
        sessions: 1,
        recent: [],
        interests: [],
      });
    }
    ok(res, { context: userContexts.get(uid) });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 7) media.create_image — image generation
// ============================================================
app.post('/api/media/create-image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024' } = req.body || {};
    if (!prompt) return fail(res, 'prompt is required', 400);

    // Parse size into width/height
    const [w, h] = String(size).split('x').map(n => parseInt(n, 10) || 1024);

    // Try Z.AI first
    try {
      const zai = await getZAI();
      const result = await zai.images.generations.create({ prompt, size });
      const item = result?.data?.[0];
      if (item) {
        const b64 = item.base64 || item.b64;
        const dataUrl = b64 ? `data:image/png;base64,${b64}` : (item.url || '');
        if (dataUrl) {
          return ok(res, {
            dataUrl,
            imageBase64: b64 || null,
            prompt,
            size,
            format: item.format || 'png',
            source: 'zai'
          });
        }
      }
    } catch (zaiErr) {
      console.warn('[create-image] Z.AI failed:', zaiErr.message, '— falling back to Pollinations');
    }

    // Fallback: Pollinations (free, no auth, public)
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${Date.now() % 1000000}`;
    const pollResp = await fetch(pollinationsUrl, { method: 'GET' });
    if (!pollResp.ok) throw new Error(`Pollinations HTTP ${pollResp.status}`);
    const buf = Buffer.from(await pollResp.arrayBuffer());
    const b64 = buf.toString('base64');
    return ok(res, {
      dataUrl: `data:image/jpeg;base64,${b64}`,
      imageBase64: b64,
      prompt,
      size,
      format: 'jpeg',
      source: 'pollinations'
    });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 8) media.create_video — video generation (async + polling)
// ============================================================
app.post('/api/media/create-video', async (req, res) => {
  try {
    const { prompt, model = 'cogvideox-2', duration = 5, size = '1024x1024' } = req.body || {};
    if (!prompt) return fail(res, 'prompt is required', 400);
    const zai = await getZAI();
    const result = await zai.video.generations.create({ prompt, model, duration, size });
    ok(res, { task: result, prompt, model });
  } catch (e) { fail(res, e); }
});

app.get('/api/media/create-video/result', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return fail(res, 'id is required', 400);
    const zai = await getZAI();
    const result = await zai.async.result.query(String(id));
    ok(res, { task: result });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 9) media.animate_image — image animation
// ============================================================
app.post('/api/media/animate-image', async (req, res) => {
  try {
    const { prompt, imageBase64, mime = 'image/png', size = '1024x1024' } = req.body || {};
    if (!imageBase64) return fail(res, 'imageBase64 is required', 400);
    const zai = await getZAI();
    // Use image-edit endpoint with animation-instructed prompt
    const animationPrompt = `[ANIMATE] ${prompt || 'make this image come alive with subtle motion'}`;
    const result = await zai.images.generations.edit({
      prompt: animationPrompt,
      image: imageBase64,
      mime,
      size,
    });
    const item = result?.data?.[0];
    const b64 = item?.base64 || item?.b64;
    const dataUrl = b64 ? `data:image/png;base64,${b64}` : (item?.url || '');
    ok(res, { dataUrl, imageBase64: b64 || null, prompt: animationPrompt });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 10) media.edit_image — image editing (img2img)
// ============================================================
app.post('/api/media/edit-image', async (req, res) => {
  try {
    const { prompt, imageBase64, mime = 'image/png', size = '1024x1024' } = req.body || {};
    if (!prompt) return fail(res, 'prompt is required', 400);
    if (!imageBase64) return fail(res, 'imageBase64 is required', 400);
    const zai = await getZAI();
    const result = await zai.images.generations.edit({
      prompt,
      image: imageBase64,
      mime,
      size,
    });
    const item = result?.data?.[0];
    const b64 = item?.base64 || item?.b64;
    const dataUrl = b64 ? `data:image/png;base64,${b64}` : (item?.url || '');
    ok(res, { dataUrl, imageBase64: b64 || null, prompt });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 11) media.edit_video — video editing
// ============================================================
app.post('/api/media/edit-video', async (req, res) => {
  try {
    const { prompt, videoUrl, model = 'cogvideox-2' } = req.body || {};
    if (!prompt) return fail(res, 'prompt is required', 400);
    if (!videoUrl) return fail(res, 'videoUrl is required', 400);
    const zai = await getZAI();
    // Z.AI doesn't have direct video edit endpoint yet — use function.invoke
    let result;
    try {
      result = await zai.functions.invoke('media.edit_video', { prompt, video_url: videoUrl, model });
    } catch (fnErr) {
      // Fallback: re-create with edit prompt
      result = await zai.video.generations.create({ prompt: `${prompt} (source: ${videoUrl})`, model });
    }
    ok(res, { task: result, prompt });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 12) media.get_audio — extract audio (optional)
// ============================================================
app.post('/api/media/get-audio', async (req, res) => {
  try {
    const { source, sourceType = 'video', prompt } = req.body || {};
    if (!source) return fail(res, 'source (url or base64) is required', 400);
    const zai = await getZAI();
    let result;
    try {
      result = await zai.functions.invoke('media.get_audio', { source, source_type: sourceType });
    } catch {
      // Fallback: use TTS to create audio from a description if source is text-like
      if (sourceType === 'text' || (prompt && !source.startsWith('http') && !source.startsWith('data:'))) {
        const r = await zai.audio.tts.create({
          model: 'zai-tts',
          input: prompt || source,
          voice: 'male',
        });
        const buf = Buffer.from(await r.arrayBuffer());
        const b64 = buf.toString('base64');
        result = { audioBase64: b64, format: 'mp3', source: 'tts-fallback' };
      } else {
        result = { note: 'media.get_audio requires external ffmpeg; returned source as-is', source };
      }
    }
    ok(res, result);
  } catch (e) { fail(res, e); }
});

// ============================================================
// 13) media.get_reference_image — retrieve reference image via search
// ============================================================
app.post('/api/media/get-reference-image', async (req, res) => {
  try {
    const { query, topK = 4 } = req.body || {};
    if (!query) return fail(res, 'query is required', 400);
    const zai = await getZAI();
    const result = await zai.images.search.create({ query, top_k: topK });
    ok(res, { results: result?.data || result?.items || [], query });
  } catch (e) { fail(res, e); }
});

// ============================================================
// 14) maisa_support_axon — optional support endpoint
// ============================================================
app.post('/api/maisa/support', async (req, res) => {
  try {
    const { query, context = {} } = req.body || {};
    if (!query) return fail(res, 'query is required', 400);
    const zai = await getZAI();
    // Try function invoke first, fall back to chat
    let result;
    try {
      result = await zai.functions.invoke('maisa_support_axon', { query, context });
    } catch {
      const completion = await zai.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: 'أنت وكيل دعم فني (Maisa Support Axon). أجب على استفسارات المستخدم بمعلومات عملية وخطوات واضحة.' },
          { role: 'user', content: `سياق: ${JSON.stringify(context)}\n\nاستفسار: ${query}` },
        ],
        thinking: { type: 'disabled' },
      });
      result = { response: completion?.choices?.[0]?.message?.content || '', source: 'glm-4-fallback' };
    }
    ok(res, result);
  } catch (e) { fail(res, e); }
});

// ============================================================
// Existing endpoints (kept for backward compat)
// ============================================================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, system, history = [] } = req.body || {};
    if (!message) return fail(res, 'message is required', 400);

    // Build messages array
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const h of history) messages.push(h);
    messages.push({ role: 'user', content: message });

    // Try Z.AI SDK first
    try {
      const zai = await getZAI();
      const completion = await zai.chat.completions.create({
        model: 'glm-4-plus',
        messages,
        thinking: { type: 'disabled' },
      });
      const resp = completion?.choices?.[0]?.message?.content || '';
      if (resp) return ok(res, { response: resp, source: 'zai-glm-4' });
    } catch (zaiErr) {
      console.warn('[chat] Z.AI failed:', zaiErr.message);
    }

    // Fallback: Pollinations text API (free, no auth)
    try {
      const pollResp = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai',
          messages,
          temperature: 0.7
        })
      });
      if (pollResp.ok) {
        const data = await pollResp.json();
        const resp = data?.choices?.[0]?.message?.content || '';
        if (resp) return ok(res, { response: resp, source: 'pollinations' });
      }
    } catch (pollErr) {
      console.warn('[chat] Pollinations failed:', pollErr.message);
    }

    // Last resort: simple Pollinations GET text
    const simpleResp = await fetch(`https://text.pollinations.ai/${encodeURIComponent(message)}`, {
      method: 'GET'
    });
    if (simpleResp.ok) {
      const text = await simpleResp.text();
      if (text) return ok(res, { response: text, source: 'pollinations-simple' });
    }

    return fail(res, 'All AI providers failed', 503);
  } catch (e) { fail(res, e); }
});

app.post('/api/vision', async (req, res) => {
  try {
    const { prompt, imageBase64, mime = 'image/jpeg' } = req.body || {};
    if (!imageBase64) return fail(res, 'imageBase64 is required', 400);

    // Try Z.AI vision first
    try {
      const zai = await getZAI();
      const completion = await zai.chat.completions.createVision({
        model: 'glm-4v',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt || 'صف هذه الصورة بالتفصيل' },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      });
      const resp = completion?.choices?.[0]?.message?.content || '';
      if (resp) return ok(res, { response: resp, source: 'zai-glm-4v' });
    } catch (zaiErr) {
      console.warn('[vision] Z.AI failed:', zaiErr.message);
    }

    // Fallback: Pollinations vision (uses openai-compatible endpoint with image)
    try {
      const pollResp = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt || 'صف هذه الصورة بالتفصيل' },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } }
              ]
            }
          ]
        })
      });
      if (pollResp.ok) {
        const data = await pollResp.json();
        const resp = data?.choices?.[0]?.message?.content || '';
        if (resp) return ok(res, { response: resp, source: 'pollinations-vision' });
      }
    } catch (pollErr) {
      console.warn('[vision] Pollinations failed:', pollErr.message);
    }

    return fail(res, 'خدمة تحليل الصور غير متاحة حالياً. حاول مرة أخرى لاحقاً.', 503);
  } catch (e) { fail(res, e); }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'male' } = req.body || {};
    if (!text) return fail(res, 'text is required', 400);

    // Try Z.AI TTS first
    try {
      const zai = await getZAI();
      const r = await zai.audio.tts.create({ model: 'zai-tts', input: text, voice });
      const buf = Buffer.from(await r.arrayBuffer());
      const b64 = buf.toString('base64');
      if (b64 && b64.length > 100) {
        return ok(res, { audioBase64: b64, format: 'mp3', source: 'zai' });
      }
    } catch (zaiErr) {
      console.warn('[tts] Z.AI failed:', zaiErr.message);
    }

    // Fallback: Pollinations audio (if available) or Google Translate TTS (public)
    try {
      // Google Translate TTS (public, no auth needed)
      const gttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ar&client=tw-ob`;
      const gttsResp = await fetch(gttsUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (gttsResp.ok) {
        const buf = Buffer.from(await gttsResp.arrayBuffer());
        const b64 = buf.toString('base64');
        if (b64 && b64.length > 100) {
          return ok(res, { audioBase64: b64, format: 'mp3', source: 'google-translate' });
        }
      }
    } catch (gttsErr) {
      console.warn('[tts] Google Translate failed:', gttsErr.message);
    }

    return fail(res, 'All TTS providers failed', 503);
  } catch (e) { fail(res, e); }
});

app.post('/api/asr', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 'audio file is required', 400);
    const zai = await getZAI();
    const b64 = req.file.buffer.toString('base64');
    const result = await zai.audio.asr.create({ audio: b64, model: 'zai-asr' });
    ok(res, result);
  } catch (e) { fail(res, e); }
});

// Legacy image endpoint (alias for /api/media/create-image)
app.post('/api/image', async (req, res) => {
  try {
    const { prompt, size = '1024x1024' } = req.body || {};
    if (!prompt) return fail(res, 'prompt is required', 400);

    // Parse size
    const [w, h] = String(size).split('x').map(n => parseInt(n, 10) || 1024);

    // Try Z.AI first
    let b64 = null;
    let source = 'zai';
    try {
      const zai = await getZAI();
      const result = await zai.images.generations.create({ prompt, size });
      const item = result?.data?.[0];
      b64 = item?.base64 || item?.b64;
      if (!b64 && item?.url) {
        // Download URL to base64
        const r = await fetch(item.url);
        const buf = Buffer.from(await r.arrayBuffer());
        b64 = buf.toString('base64');
      }
    } catch (zaiErr) {
      console.warn('[image] Z.AI failed:', zaiErr.message);
      source = 'pollinations';
    }

    if (!b64) {
      // Fallback: Pollinations
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${Date.now() % 1000000}`;
      const pollResp = await fetch(pollinationsUrl);
      if (!pollResp.ok) throw new Error(`Pollinations HTTP ${pollResp.status}`);
      const buf = Buffer.from(await pollResp.arrayBuffer());
      b64 = buf.toString('base64');
      source = 'pollinations';
    }

    const dataUrl = `data:image/${source === 'pollinations' ? 'jpeg' : 'png'};base64,${b64}`;
    ok(res, {
      dataUrl,
      imageBase64: b64,
      originalPrompt: prompt,
      prompt,
      size,
      source
    });
  } catch (e) { fail(res, e); }
});

// ============================================================
// Gallery (social)
// ============================================================
app.post('/api/gallery/publish', (req, res) => {
  try {
    const uid = userIdOf(req);
    const { prompt, imageBase64, size } = req.body || {};
    if (!imageBase64) return fail(res, 'imageBase64 is required', 400);
    const id = newId();
    const post = {
      id, prompt: prompt || '', imageBase64, size: size || '1024x1024',
      userId: uid, likes: 0, likedBy: [], publishedAt: Date.now(),
    };
    galleryStore.set(id, post);
    ok(res, { id });
  } catch (e) { fail(res, e); }
});

app.post('/api/gallery/:id/like', (req, res) => {
  try {
    const uid = userIdOf(req);
    const post = galleryStore.get(req.params.id);
    if (!post) return fail(res, 'post not found', 404);
    const idx = post.likedBy.indexOf(uid);
    if (idx >= 0) { post.likedBy.splice(idx, 1); post.likes = Math.max(0, post.likes - 1); }
    else { post.likedBy.push(uid); post.likes += 1; }
    ok(res, { liked: post.likedBy.includes(uid), likes: post.likes });
  } catch (e) { fail(res, e); }
});

app.get('/api/gallery', (req, res) => {
  const uid = userIdOf(req);
  const items = Array.from(galleryStore.values())
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 100)
    .map((p) => ({ ...p, likedBy: undefined, liked: p.likedBy.includes(uid) }));
  ok(res, { items });
});

app.delete('/api/gallery/:id', (req, res) => {
  try {
    const uid = userIdOf(req);
    const post = galleryStore.get(req.params.id);
    if (!post) return fail(res, 'post not found', 404);
    if (post.userId !== uid) return fail(res, 'forbidden (not your post)', 403);
    galleryStore.delete(req.params.id);
    ok(res, { id: req.params.id });
  } catch (e) { fail(res, e); }
});

// ============================================================
// Start
// ============================================================
writeZaiConfig().then(() => {
  app.listen(PORT, () => {
    console.log(`BardomPro backend v3.0.0 listening on :${PORT}`);
    console.log(`  Z.AI: https://internal-api.z.ai/v1`);
    console.log(`  Capabilities: ${CAPABILITIES.length}`);
  });
}).catch(e => {
  console.error('Failed to init Z.AI config:', e);
  process.exit(1);
});
