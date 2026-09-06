// ============================================================
// Z.AI Relay Server for Fly.io (HK region)
// 
// This relay runs in a region that can reach internal-api.z.ai
// (which resolves to private 172.25.x.x IPs only accessible from
// inside Alibaba Cloud HK network).
//
// The relay exposes simple proxy endpoints that the Render backend
// calls. All Z.AI credentials live in env vars (never in code).
// ============================================================

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Z.AI configuration from environment variables
const ZAI_BASE = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1';
const ZAI_KEY  = process.env.ZAI_API_KEY  || 'Z.ai';
const ZAI_CHAT = process.env.ZAI_CHAT_ID  || '';
const ZAI_USER = process.env.ZAI_USER_ID  || '';
const ZAI_TOKEN= process.env.ZAI_TOKEN    || '';
const PORT     = process.env.PORT || 3000;

// Build Z.AI auth headers
function zaiHeaders(extra = {}) {
  const h = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ZAI_KEY}`,
    'X-Z-AI-From': 'Z'
  };
  if (ZAI_CHAT)  h['X-Chat-Id'] = ZAI_CHAT;
  if (ZAI_USER)  h['X-User-Id'] = ZAI_USER;
  if (ZAI_TOKEN) h['X-Token']   = ZAI_TOKEN;
  return { ...h, ...extra };
}

// ============================================================
// Health check
// ============================================================
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    relay: true,
    version: '1.0.0',
    region: process.env.FLY_REGION || 'unknown',
    time: new Date().toISOString(),
    upstream: ZAI_BASE,
    configured: !!(ZAI_KEY && ZAI_TOKEN)
  });
});

// ============================================================
// Video generation (async task creation)
// ============================================================
app.post('/video/generation', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/video/generation`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(30000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[video/generation] error:', e.message);
    res.status(502).json({ error: e.message, upstream: ZAI_BASE });
  }
});

// ============================================================
// Async result polling (for video tasks)
// Z.AI uses ?id= query param (not path param)
// ============================================================
app.get('/async-result/:id', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/async-result?id=${encodeURIComponent(req.params.id)}`, {
      method: 'GET',
      headers: zaiHeaders(),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[async-result] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Also support query param style
app.get('/async-result', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id query param required' });
  try {
    const r = await fetch(`${ZAI_BASE}/async-result?id=${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: zaiHeaders(),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[async-result] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
// Image generation (for fallback scenarios)
// ============================================================
app.post('/images/generations', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/images/generations`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(90000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[images/generations] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
// Image edit (for animate-image)
// ============================================================
app.post('/images/generations/edit', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/images/generations/edit`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(90000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[images/generations/edit] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
// Vision (image analysis)
// ============================================================
app.post('/chat/completions/vision', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/chat/completions/vision`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(60000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[chat/completions/vision] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
// Chat completions (text - as fallback for OpenRouter)
// ============================================================
app.post('/chat/completions', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(60000)
    });
    const data = await r.text();
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(data);
  } catch (e) {
    console.error('[chat/completions] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
// TTS (text-to-speech)
// ============================================================
app.post('/audio/tts', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/audio/tts`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body || {}),
      signal: AbortSignal.timeout(60000)
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(r.status);
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    console.error('[audio/tts] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ============================================================
// Start server
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=== Z.AI Relay Server ===`);
  console.log(`Listening on :${PORT}`);
  console.log(`Upstream: ${ZAI_BASE}`);
  console.log(`Region: ${process.env.FLY_REGION || 'local'}`);
  console.log(`Configured: ${ZAI_KEY && ZAI_TOKEN ? 'yes' : 'NO (missing env vars)'}`);
});
