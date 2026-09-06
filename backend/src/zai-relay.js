// Z.AI Relay Server - runs in an environment that can reach internal-api.z.ai
// Exposes /video/* and /async-result/* endpoints that Render backend calls
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const ZAI_BASE = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1';
const ZAI_KEY = process.env.ZAI_API_KEY || 'Z.ai';
const ZAI_CHAT = process.env.ZAI_CHAT_ID || 'd5a5dfcd-27e7-4d4a-b56f-13313900eae7';
const ZAI_USER = process.env.ZAI_USER_ID || 'ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90';
const ZAI_TOKEN = process.env.ZAI_TOKEN || '';
const PORT = process.env.RELAY_PORT || 3001;

function zaiHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ZAI_KEY}`,
    'X-Z-AI-From': 'Z',
    'X-Chat-Id': ZAI_CHAT,
    'X-User-Id': ZAI_USER,
    'X-Token': ZAI_TOKEN
  };
}

// Health
app.get('/healthz', (req, res) => {
  res.json({ ok: true, relay: true, time: new Date().toISOString() });
});

// Video generation
app.post('/video/generation', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/video/generation`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000)
    });
    const data = await r.text();
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type') || 'application/json').send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Async result query
app.get('/async-result/:id', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/async-result/${req.params.id}`, {
      method: 'GET',
      headers: zaiHeaders(),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.text();
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type') || 'application/json').send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Image generation (for edit/animate)
app.post('/images/generations', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/images/generations`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60000)
    });
    const data = await r.text();
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type') || 'application/json').send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Image edit
app.post('/images/generations/edit', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/images/generations/edit`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60000)
    });
    const data = await r.text();
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type') || 'application/json').send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Vision
app.post('/chat/completions/vision', async (req, res) => {
  try {
    const r = await fetch(`${ZAI_BASE}/chat/completions/vision`, {
      method: 'POST',
      headers: zaiHeaders(),
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000)
    });
    const data = await r.text();
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type') || 'application/json').send(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Z.AI Relay listening on :${PORT}`);
  console.log(`  Upstream: ${ZAI_BASE}`);
});
