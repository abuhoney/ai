/* ============================================================
 * BardomPro AI v3.0 — Frontend logic (No-Settings, Robust Edition)
 *
 * Key improvements in this version:
 *  - No Z.AI/Meta mentions in user-facing UI (rebranded to neutral AI)
 *  - Robust network handling: 15s health timeout, 60s API timeout
 *  - Retry-once-with-backoff for transient network failures
 *  - Auto-recovery from degraded mode on successful call
 *  - Friendly Arabic error messages (no "Failed to fetch")
 *
 * Capability tree:
 *  - Intelligence (3 + 1 optional): chat, vision, p13n, maisa (optional)
 *  - Media (7 + 1 optional): create-image, create-video, animate-image,
 *                            edit-image, edit-video, get-audio (opt),
 *                            get-reference-image, gallery
 *  - Tools (5): python-execution, container-python, file-search,
 *              browser-search, meta-search (internal content search)
 * ============================================================ */

const CONFIG_URL = './config.json';
let CONFIG = null;
let BACKEND_URL = '';
let USER_ID = '';
let DEGRADED = false;
let ACTIVE_BACKEND_IDX = 0;

// Timeouts (ms)
const HEALTH_TIMEOUT = 15000;   // 15s — Render cold start can take 10s
const API_TIMEOUT = 60000;      // 60s — image gen can take 30-40s
const RETRY_DELAY = 1200;       // 1.2s backoff before retry

// Server-side capabilities that REQUIRE the backend (cannot work in degraded mode)
const SERVER_ONLY_CAPS = new Set([
  'python-execution',
  'container-python',
  'file-search',
]);

// === Capability tree ===
const TREE = {
  intelligence: [
    { id: 'chat', label: 'محادثة' },
    { id: 'vision', label: 'رؤية' },
    { id: 'p13n', label: 'سياق المستخدم' },
    { id: 'maisa', label: 'الدعم الفني', optional: true },
  ],
  media: [
    { id: 'create-image', label: 'توليد صورة' },
    { id: 'create-video', label: 'توليد فيديو' },
    { id: 'animate-image', label: 'تحريك صورة' },
    { id: 'edit-image', label: 'تعديل صورة' },
    { id: 'edit-video', label: 'تعديل فيديو' },
    { id: 'get-audio', label: 'استخراج صوت', optional: true },
    { id: 'get-reference-image', label: 'صورة مرجعية' },
    { id: 'gallery', label: 'المعرض' },
  ],
  tools: [
    { id: 'python-execution', label: 'Python' },
    { id: 'container-python', label: 'حاوية Python' },
    { id: 'file-search', label: 'بحث ملفات' },
    { id: 'browser-search', label: 'بحث ويب' },
    { id: 'meta-search', label: 'بحث المحتوى' },
  ],
};

// ============================================================
// Helpers
// ============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function setLoading(btn, text = '...جاري') {
  if (!btn) return;
  if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
}
function resetBtn(btn) {
  if (!btn || !btn.dataset.origText) return;
  btn.textContent = btn.dataset.origText;
  btn.disabled = false;
}

// Translate network errors to friendly Arabic messages
function friendlyError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network error')) {
    return 'تعذّر الاتصال بالخادم — تحقّق من الإنترنت أو أن الخادم قد يكون في وضع السكون. سيُعاد المحاولة تلقائياً.';
  }
  if (m.includes('aborted') || m.includes('timeout')) {
    return 'انتهت مهلة الاتصال — قد يكون الخادم يستيقظ من السكون. حاول مرة أخرى.';
  }
  if (m.includes('cors') || m.includes('blocked')) {
    return 'حظر المتصفّح الطلب بسبب CORS. تحقّق من إعدادات الشبكة.';
  }
  return String(err?.message || err || 'خطأ غير معروف');
}

// ============================================================
// Toast
// ============================================================
let toastTimer = null;
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ============================================================
// Config loader — no settings, all auto
// ============================================================
async function initConfig() {
  // Allow AndroidBridge to override config (when running in APK)
  let cfgOverride = null;
  if (typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge.getConfig) {
    try {
      cfgOverride = JSON.parse(window.AndroidBridge.getConfig());
    } catch {}
  }

  try {
    const resp = await fetch(CONFIG_URL, { cache: 'no-store' });
    CONFIG = await resp.json();
  } catch (e) {
    // Fallback embedded config if fetch fails
    CONFIG = {
      backendUrl: 'https://bardom.onrender.com',
      fallbackBackends: ['http://localhost:3000', 'http://10.0.2.2:3000'],
      userId: 'ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90',
      version: '3.0.0',
      imageSizes: [{ label: 'مربع 1024×1024', value: '1024x1024' }],
      defaultImageSize: '1024x1024',
    };
  }

  // Merge AndroidBridge overrides
  if (cfgOverride) {
    if (cfgOverride.backendUrl) CONFIG.backendUrl = cfgOverride.backendUrl;
    if (cfgOverride.userId) CONFIG.userId = cfgOverride.userId;
    if (cfgOverride.version) CONFIG.version = cfgOverride.version;
  }

  USER_ID = CONFIG.userId;
  BACKEND_URL = CONFIG.backendUrl;

  // populate image sizes
  const sel = document.getElementById('imageSize');
  for (const sz of CONFIG.imageSizes || []) {
    const opt = document.createElement('option');
    opt.value = sz.value; opt.textContent = sz.label;
    if (sz.value === CONFIG.defaultImageSize) opt.selected = true;
    sel.appendChild(opt);
  }

  // counts
  for (const [cat, caps] of Object.entries(TREE)) {
    const el = document.getElementById('cnt-' + cat);
    if (el) el.textContent = caps.length;
  }
}

// ============================================================
// Auto-discovery: try primary backend, then fallback list
// Each candidate gets 2 attempts with backoff
// ============================================================
async function probeBackend(url, attempt = 1) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT);
  try {
    // cache-busting to avoid stale CDN response
    const r = await fetch(`${url}/healthz?_=${Date.now()}`, {
      headers: { 'X-User-Id': USER_ID, 'Accept': 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
      mode: 'cors',
    });
    clearTimeout(tid);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.ok ? j : null;
  } catch (e) {
    clearTimeout(tid);
    // If first attempt failed with network error, retry once after delay
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY));
      return probeBackend(url, attempt + 1);
    }
    return null;
  }
}

async function autoDiscoverBackend() {
  const pill = document.getElementById('connPill');
  const status = document.getElementById('backendStatus');
  pill.classList.remove('ok', 'err', 'warn');
  pill.classList.add('warn');
  status.textContent = 'جارٍ الاتصال بالخادم...';

  // Build candidate list (preserve order, dedupe)
  const seen = new Set();
  const candidates = [CONFIG.backendUrl, ...(CONFIG.fallbackBackends || [])]
    .filter(Boolean)
    .filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });

  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    let hostname = url;
    try { hostname = new URL(url).hostname; } catch {}
    status.textContent = `فحص ${hostname}... (محاولة 1)`;
    const health = await probeBackend(url);
    if (health) {
      BACKEND_URL = url;
      ACTIVE_BACKEND_IDX = i;
      DEGRADED = false;
      pill.classList.remove('warn', 'err');
      pill.classList.add('ok');
      status.textContent = `متصل ✓ ${health.version || 'v3'}`;
      hideDegradedBanner();
      toast('BardomPro جاهز للعمل', 'success');
      return true;
    }
  }

  // No backend reachable → degraded mode
  DEGRADED = true;
  BACKEND_URL = candidates[0] || '';
  pill.classList.remove('warn', 'ok');
  pill.classList.add('err');
  status.textContent = '⚠ وضع محدود';
  showDegradedBanner('الخادم غير متاح حالياً. القدرات التي تتطلب خادماً (Python, بحث ملفات) معطّلة مؤقتاً. القدرات الأخرى تعمل تلقائياً عند عودة الخادم. اضغط ↻ لإعادة المحاولة.');
  return false;
}

function showDegradedBanner(reason) {
  const banner = document.getElementById('degradedBanner');
  document.getElementById('degradedReason').textContent = reason;
  banner.hidden = false;
}
function hideDegradedBanner() {
  document.getElementById('degradedBanner').hidden = true;
}

// Retry button on the degraded banner
document.getElementById('retryConnBtn').addEventListener('click', () => {
  toast('إعادة المحاولة...', '');
  autoDiscoverBackend();
});

// ============================================================
// API call wrapper — robust with timeout + retry
// ============================================================
async function apiCall(path, options = {}, opts = {}) {
  // If degraded, attempt to re-discover first; if still degraded, return friendly error
  if (DEGRADED && !opts.skipRecover) {
    const recovered = await autoDiscoverBackend();
    if (!recovered) {
      return { ok: false, error: 'الخادم غير متاح حالياً (وضع محدود). اضغط ↻ لإعادة المحاولة.' };
    }
  }

  const url = `${BACKEND_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', 'X-User-Id': USER_ID, 'Accept': 'application/json', ...(options.headers || {}) };
  const timeout = opts.timeout || API_TIMEOUT;
  const maxAttempts = opts.maxAttempts || 2; // 2 attempts = retry once

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
      const resp = await fetch(url, { ...options, headers, signal: ctrl.signal, cache: 'no-store', mode: 'cors' });
      clearTimeout(tid);
      let data;
      try { data = await resp.json(); }
      catch { data = { ok: false, error: `استجابة غير صالحة من الخادم (HTTP ${resp.status})` }; }
      if (!resp.ok && !data.error) data.error = `خطأ من الخادم: HTTP ${resp.status}`;
      // On 5xx server errors, retry once
      if (resp.status >= 500 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        continue;
      }
      // Successful or non-retriable error — return
      return data;
    } catch (e) {
      clearTimeout(tid);
      // Network error — retry once
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        continue;
      }
      // Final failure — check if other backends might work
      const fallbackRecovered = await tryFallbackBackends();
      if (fallbackRecovered) {
        // Retry the call with the new BACKEND_URL (one attempt only)
        return apiCall(path, options, { ...opts, skipRecover: true, maxAttempts: 1 });
      }
      return { ok: false, error: friendlyError(e) };
    }
  }
  return { ok: false, error: 'تعذّر إتمام الطلب بعد عدة محاولات.' };
}

// Try other backends in fallback list when current fails
async function tryFallbackBackends() {
  const seen = new Set();
  const candidates = [CONFIG.backendUrl, ...(CONFIG.fallbackBackends || [])]
    .filter(Boolean)
    .filter((u) => u !== BACKEND_URL)
    .filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });

  for (const url of candidates) {
    const health = await probeBackend(url);
    if (health) {
      BACKEND_URL = url;
      DEGRADED = false;
      const pill = document.getElementById('connPill');
      pill.classList.remove('warn', 'err');
      pill.classList.add('ok');
      document.getElementById('backendStatus').textContent = `متصل ✓ ${health.version || 'v3'}`;
      hideDegradedBanner();
      return true;
    }
  }
  return false;
}

// Check if a capability is available (not server-only in degraded mode)
function isCapAvailable(capId) {
  if (!DEGRADED) return true;
  return !SERVER_ONLY_CAPS.has(capId);
}

// ============================================================
// Tab navigation
// ============================================================
let currentCat = 'intelligence';
let currentSub = 'chat';

function renderSubTabs() {
  const wrap = document.getElementById('subTabs');
  wrap.innerHTML = '';
  for (const cap of TREE[currentCat]) {
    const b = document.createElement('button');
    b.className = 'sub-tab' + (cap.id === currentSub ? ' active' : '') + (cap.optional ? ' opt' : '');
    if (!isCapAvailable(cap.id)) b.classList.add('disabled');
    b.textContent = cap.label + (cap.optional ? ' ★' : '');
    b.dataset.sub = cap.id;
    b.addEventListener('click', () => switchSub(cap.id));
    wrap.appendChild(b);
  }
}

function switchCat(cat) {
  currentCat = cat;
  document.querySelectorAll('.cat-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.cat === cat);
    b.setAttribute('aria-selected', b.dataset.cat === cat ? 'true' : 'false');
  });
  currentSub = TREE[cat][0].id;
  renderSubTabs();
  switchPanel(currentSub);
}

function switchSub(subId) {
  currentSub = subId;
  document.querySelectorAll('.sub-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.sub === subId);
  });
  switchPanel(subId);
  // Lazy-load panels
  if (subId === 'gallery') loadGallery();
  if (subId === 'p13n') loadP13n();
  // Show "requires backend" notice for server-only caps in degraded mode
  if (!isCapAvailable(subId)) {
    showPanelOfflineNotice(subId);
  }
}

function switchPanel(panelId) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  const p = document.querySelector(`.panel[data-panel="${panelId}"]`);
  if (p) p.classList.add('active');
}

function showPanelOfflineNotice(panelId) {
  const panel = document.querySelector(`.panel[data-panel="${panelId}"]`);
  if (!panel) return;
  let notice = panel.querySelector('.offline-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'offline-notice result-card';
    panel.querySelector('.scroll-area')?.prepend(notice);
  }
  notice.innerHTML = `<strong>⚠ يتطلب اتصالاً بالخادم</strong><br>هذه القدرة تحتاج إلى اتصال بخادم BardomPro. تحقّق من مؤشّر الاتصال أعلى الصفحة أو اضغط ↻ لإعادة المحاولة.`;
}

document.querySelectorAll('.cat-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchCat(btn.dataset.cat));
});

// ============================================================
// CHAT
// ============================================================
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatMessages = document.getElementById('chatMessages');
let chatHistory = [];

chatInput.addEventListener('input', () => autoGrow(chatInput));
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChat(); }
});
chatSend.addEventListener('click', (e) => { e.preventDefault(); submitChat(); });

async function submitChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = '';
  autoGrow(chatInput);

  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  userMsg.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg></div><div class="msg-body">${escapeHtml(msg)}</div>`;
  chatMessages.appendChild(userMsg);

  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'msg assistant loading';
  loadingMsg.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.2-8.5"/></svg></div><div class="msg-body">يفكّر...</div>`;
  chatMessages.appendChild(loadingMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  chatHistory.push({ role: 'user', content: msg });
  setLoading(chatSend);

  const data = await apiCall('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message: msg,
      system: 'أنت BardomPro AI v3 — مساعد ذكي بالعربية. لديك 14 قدرة. أجب بدقة وإيجاز.',
      history: chatHistory.slice(-10),
    }),
  });
  loadingMsg.remove();
  if (data.ok) {
    const answer = data.response || '';
    chatHistory.push({ role: 'assistant', content: answer });
    const m = document.createElement('div');
    m.className = 'msg assistant';
    m.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2z"/><path d="M9 18h6M10 22h4"/></svg></div><div class="msg-body">${escapeHtml(answer)}</div>`;
    chatMessages.appendChild(m);
  } else {
    const m = document.createElement('div');
    m.className = 'msg assistant error';
    m.innerHTML = `<div class="msg-avatar">⚠</div><div class="msg-body">${escapeHtml(data.error || 'غير معروف')}${DEGRADED ? '<br><small>الخادم غير متاح. اضغط ↻ أعلى الصفحة لإعادة المحاولة.</small>' : ''}</div>`;
    chatMessages.appendChild(m);
  }
  resetBtn(chatSend);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================
// VISION
// ============================================================
const visionDropzone = document.getElementById('visionDropzone');
const visionFile = document.getElementById('visionFile');
const visionPreview = document.getElementById('visionPreview');
const visionPrompt = document.getElementById('visionPrompt');
const visionAnalyze = document.getElementById('visionAnalyze');
const visionResult = document.getElementById('visionResult');
let visionCurrentBase64 = null;

setupDropzone(visionDropzone, visionFile, (file) => handleImageFile(file, visionPreview, visionDropzone, (b64) => {
  visionCurrentBase64 = b64;
  visionResult.textContent = 'الصورة جاهزة. اضغط "حلل" أو اكتب سؤالاً محدداً.';
}));

function handleImageFile(file, previewEl, dropzoneEl, cb) {
  if (!file.type.startsWith('image/')) { toast('الملف ليس صورة', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    previewEl.src = reader.result;
    previewEl.hidden = false;
    dropzoneEl.hidden = true;
    cb(reader.result.split(',')[1]);
  };
  reader.readAsDataURL(file);
}

function setupDropzone(dz, fileInput, handler) {
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handler(fileInput.files[0]); });
}

visionAnalyze.addEventListener('click', async () => {
  if (!visionCurrentBase64) { toast('اختر صورة أولاً', 'error'); return; }
  setLoading(visionAnalyze);
  visionResult.textContent = 'جاري التحليل عبر نموذج الرؤية المتقدّم...';
  const data = await apiCall('/api/vision', {
    method: 'POST',
    body: JSON.stringify({
      prompt: visionPrompt.value.trim() || 'صف هذه الصورة بالتفصيل',
      imageBase64: visionCurrentBase64,
      mime: 'image/jpeg',
    }),
  });
  if (data.ok) visionResult.textContent = data.response || 'لا يوجد رد';
  else visionResult.textContent = `خطأ: ${data.error}`;
  resetBtn(visionAnalyze);
});

// ============================================================
// IMAGE GEN
// ============================================================
const imagePrompt = document.getElementById('imagePrompt');
const imageSize = document.getElementById('imageSize');
const imageGen = document.getElementById('imageGen');
const imageGrid = document.getElementById('imageGrid');

imageGen.addEventListener('click', async (e) => {
  e.preventDefault();
  const prompt = imagePrompt.value.trim();
  if (!prompt) { toast('اكتب وصفاً للصورة', 'error'); return; }
  const size = imageSize.value;
  setLoading(imageGen);

  const card = document.createElement('div');
  card.className = 'image-card';
  card.innerHTML = `<div class="image-meta">جاري توليد الصورة (قد يستغرق 30-40 ثانية)...</div>`;
  imageGrid.prepend(card);

  const data = await apiCall('/api/media/create-image', {
    method: 'POST',
    body: JSON.stringify({ prompt, size }),
  }, { timeout: 90000 }); // 90s for image gen

  if (data.ok) {
    const orig = data.prompt || prompt;
    card.innerHTML = `
      <img src="${data.dataUrl}" alt="${escapeHtml(orig)}" data-full="${data.dataUrl}">
      <div class="image-meta">${escapeHtml(orig)}</div>
      <div class="image-actions">
        <button class="image-action save" title="حفظ">⬇ حفظ</button>
        <button class="image-action like" title="إعجاب">♥ إعجاب</button>
        <button class="image-action publish" title="نشر">↗ نشر</button>
      </div>`;
    const img = card.querySelector('img');
    img.addEventListener('click', () => openFullImage(img.dataset.full));
    card.querySelector('.image-action.save').addEventListener('click', () => saveImage(data.imageBase64, prompt));
    card.querySelector('.image-action.like').addEventListener('click', (e2) => toggleLikeLocal(e2.currentTarget));
    card.querySelector('.image-action.publish').addEventListener('click', () => publishImage(data.imageBase64, orig, size, card));
  } else {
    card.querySelector('.image-meta').textContent = `فشل: ${data.error}`;
    card.style.opacity = '0.6';
    setTimeout(() => card.remove(), 5000);
  }
  resetBtn(imageGen);
});

function openFullImage(dataUrl) {
  const w = window.open();
  if (w) w.document.write(`<title>عرض كامل</title><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh"><img src="${dataUrl}" style="max-width:100%;max-height:100%"></body>`);
}

function saveImage(base64, prompt) {
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${base64}`;
  const safe = (prompt || 'image').replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 40);
  a.download = `bardompro_${safe}_${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('تم حفظ الصورة في جهازك', 'success');
}

function toggleLikeLocal(btn) {
  btn.classList.toggle('active');
  toast(btn.classList.contains('active') ? 'أعجبتك الصورة' : 'أزلت الإعجاب', 'success');
}

async function publishImage(imageBase64, prompt, size, card) {
  const btn = card.querySelector('.image-action.publish');
  setLoading(btn, '...جاري النشر');
  const data = await apiCall('/api/gallery/publish', {
    method: 'POST',
    body: JSON.stringify({ prompt, imageBase64, size }),
  });
  if (data.ok) {
    btn.textContent = '✓ نُشر';
    btn.classList.add('active');
    btn.disabled = false;
    toast('نُشرت الصورة في المعرض العام', 'success');
  } else {
    btn.textContent = '↗ نشر';
    btn.disabled = false;
    toast(`فشل النشر: ${data.error}`, 'error');
  }
}

// ============================================================
// CREATE VIDEO
// ============================================================
const videoPrompt = document.getElementById('videoPrompt');
const videoModel = document.getElementById('videoModel');
const videoDuration = document.getElementById('videoDuration');
const videoGen = document.getElementById('videoGen');
const videoResult = document.getElementById('videoResult');
const videoPoll = document.getElementById('videoPoll');
const videoArea = document.getElementById('videoArea');
let videoTaskId = null;

videoGen.addEventListener('click', async () => {
  const prompt = videoPrompt.value.trim();
  if (!prompt) { toast('اكتب وصفاً للفيديو', 'error'); return; }
  setLoading(videoGen);
  videoResult.textContent = 'جاري إنشاء مهمة الفيديو...';
  const data = await apiCall('/api/media/create-video', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      model: videoModel.value,
      duration: parseInt(videoDuration.value, 10) || 5,
    }),
  });
  if (data.ok) {
    videoResult.textContent = `تم إنشاء المهمة:\n${JSON.stringify(data.task, null, 2)}`;
    videoTaskId = data.task?.id || data.task?.task_id || data.task?.taskId;
    if (videoTaskId) { videoPoll.hidden = false; }
  } else {
    videoResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(videoGen);
});

videoPoll.addEventListener('click', async () => {
  if (!videoTaskId) return;
  setLoading(videoPoll);
  const data = await apiCall(`/api/media/create-video/result?id=${encodeURIComponent(videoTaskId)}`);
  if (data.ok) {
    videoResult.textContent = `الحالة:\n${JSON.stringify(data.task, null, 2)}`;
    const url = data.task?.video_url || data.task?.url || data.task?.output?.[0]?.url;
    if (url) {
      videoArea.hidden = false;
      videoArea.innerHTML = `<video controls autoplay muted src="${escapeHtml(url)}"></video>`;
    }
  } else {
    videoResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(videoPoll);
});

// ============================================================
// ANIMATE IMAGE
// ============================================================
const animDropzone = document.getElementById('animDropzone');
const animFile = document.getElementById('animFile');
const animPreview = document.getElementById('animPreview');
const animPrompt = document.getElementById('animPrompt');
const animGen = document.getElementById('animGen');
const animGrid = document.getElementById('animGrid');
let animCurrentBase64 = null;

setupDropzone(animDropzone, animFile, (file) => handleImageFile(file, animPreview, animDropzone, (b64) => { animCurrentBase64 = b64; }));

animGen.addEventListener('click', async () => {
  if (!animCurrentBase64) { toast('ارفع صورة أولاً', 'error'); return; }
  const prompt = animPrompt.value.trim() || 'make this image come alive with subtle motion';
  setLoading(animGen);
  const card = document.createElement('div');
  card.className = 'image-card';
  card.innerHTML = `<div class="image-meta">جاري تحريك الصورة...</div>`;
  animGrid.prepend(card);
  const data = await apiCall('/api/media/animate-image', {
    method: 'POST',
    body: JSON.stringify({ prompt, imageBase64: animCurrentBase64 }),
  }, { timeout: 90000 });
  if (data.ok) {
    card.innerHTML = `
      <img src="${data.dataUrl}" alt="animated">
      <div class="image-meta">${escapeHtml(prompt)}</div>
      <div class="image-actions">
        <button class="image-action save">⬇ حفظ</button>
      </div>`;
    card.querySelector('img').addEventListener('click', () => openFullImage(data.dataUrl));
    card.querySelector('.image-action.save').addEventListener('click', () => saveImage(data.imageBase64, prompt));
  } else {
    card.querySelector('.image-meta').textContent = `فشل: ${data.error}`;
    setTimeout(() => card.remove(), 5000);
  }
  resetBtn(animGen);
});

// ============================================================
// EDIT IMAGE
// ============================================================
const editDropzone = document.getElementById('editDropzone');
const editFile = document.getElementById('editFile');
const editPreview = document.getElementById('editPreview');
const editPrompt = document.getElementById('editPrompt');
const editGen = document.getElementById('editGen');
const editGrid = document.getElementById('editGrid');
let editCurrentBase64 = null;

setupDropzone(editDropzone, editFile, (file) => handleImageFile(file, editPreview, editDropzone, (b64) => { editCurrentBase64 = b64; }));

editGen.addEventListener('click', async () => {
  if (!editCurrentBase64) { toast('ارفع صورة أولاً', 'error'); return; }
  const prompt = editPrompt.value.trim();
  if (!prompt) { toast('اكتب التعديل المطلوب', 'error'); return; }
  setLoading(editGen);
  const card = document.createElement('div');
  card.className = 'image-card';
  card.innerHTML = `<div class="image-meta">جاري تعديل الصورة...</div>`;
  editGrid.prepend(card);
  const data = await apiCall('/api/media/edit-image', {
    method: 'POST',
    body: JSON.stringify({ prompt, imageBase64: editCurrentBase64 }),
  }, { timeout: 90000 });
  if (data.ok) {
    card.innerHTML = `
      <img src="${data.dataUrl}" alt="edited">
      <div class="image-meta">${escapeHtml(prompt)}</div>
      <div class="image-actions">
        <button class="image-action save">⬇ حفظ</button>
      </div>`;
    card.querySelector('img').addEventListener('click', () => openFullImage(data.dataUrl));
    card.querySelector('.image-action.save').addEventListener('click', () => saveImage(data.imageBase64, prompt));
  } else {
    card.querySelector('.image-meta').textContent = `فشل: ${data.error}`;
    setTimeout(() => card.remove(), 5000);
  }
  resetBtn(editGen);
});

// ============================================================
// EDIT VIDEO
// ============================================================
const editVideoUrl = document.getElementById('editVideoUrl');
const editVideoPrompt = document.getElementById('editVideoPrompt');
const editVideoGen = document.getElementById('editVideoGen');
const editVideoResult = document.getElementById('editVideoResult');

editVideoGen.addEventListener('click', async () => {
  const url = editVideoUrl.value.trim();
  const prompt = editVideoPrompt.value.trim();
  if (!url) { toast('أدخل رابط الفيديو', 'error'); return; }
  if (!prompt) { toast('اكتب التعديل المطلوب', 'error'); return; }
  setLoading(editVideoGen);
  editVideoResult.textContent = 'جاري تعديل الفيديو...';
  const data = await apiCall('/api/media/edit-video', {
    method: 'POST',
    body: JSON.stringify({ prompt, videoUrl: url }),
  });
  if (data.ok) {
    editVideoResult.textContent = `النتيجة:\n${JSON.stringify(data.task, null, 2)}`;
  } else {
    editVideoResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(editVideoGen);
});

// ============================================================
// GET AUDIO (optional)
// ============================================================
const audioSourceType = document.getElementById('audioSourceType');
const audioSource = document.getElementById('audioSource');
const audioGen = document.getElementById('audioGen');
const audioResult = document.getElementById('audioResult');
const audioPlayer = document.getElementById('audioPlayer');

audioGen.addEventListener('click', async () => {
  const source = audioSource.value.trim();
  if (!source) { toast('أدخل المصدر', 'error'); return; }
  setLoading(audioGen);
  audioResult.textContent = 'جاري استخراج الصوت...';
  const data = await apiCall('/api/media/get-audio', {
    method: 'POST',
    body: JSON.stringify({ source, sourceType: audioSourceType.value, prompt: source }),
  });
  if (data.ok) {
    if (data.audioBase64) {
      const mime = data.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
      audioPlayer.src = `data:${mime};base64,${data.audioBase64}`;
      audioPlayer.hidden = false;
      audioPlayer.play().catch(() => {});
      audioResult.textContent = `تم بنجاح (المصدر: ${data.source || 'محرّك الصوت'})`;
    } else {
      audioResult.textContent = `النتيجة:\n${JSON.stringify(data, null, 2)}`;
    }
  } else {
    audioResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(audioGen);
});

// ============================================================
// GET REFERENCE IMAGE
// ============================================================
const refQuery = document.getElementById('refQuery');
const refSearch = document.getElementById('refSearch');
const refGrid = document.getElementById('refGrid');

refSearch.addEventListener('click', async () => {
  const q = refQuery.value.trim();
  if (!q) { toast('اكتب استعلام البحث', 'error'); return; }
  setLoading(refSearch);
  refGrid.innerHTML = '<div class="gallery-empty">جارٍ البحث عبر محرّك الصور...</div>';
  const data = await apiCall('/api/media/get-reference-image', {
    method: 'POST',
    body: JSON.stringify({ query: q }),
  });
  if (data.ok && data.results?.length) {
    refGrid.innerHTML = '';
    for (const r of data.results) {
      const url = r.url || r.image_url || (r.b64 ? `data:image/png;base64,${r.b64}` : null);
      if (!url) continue;
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <img src="${escapeHtml(url)}" alt="${escapeHtml(r.title || q)}">
        <div class="gallery-card-meta">
          <div class="gallery-card-prompt">${escapeHtml(r.title || r.snippet || q)}</div>
        </div>`;
      card.querySelector('img').addEventListener('click', () => openFullImage(url));
      refGrid.appendChild(card);
    }
  } else {
    refGrid.innerHTML = `<div class="gallery-empty">لا نتائج. ${data.ok ? '' : escapeHtml(data.error || '')}</div>`;
  }
  resetBtn(refSearch);
});

// ============================================================
// GALLERY
// ============================================================
const galleryGrid = document.getElementById('galleryGrid');
const galleryRefresh = document.getElementById('galleryRefresh');
galleryRefresh.addEventListener('click', () => loadGallery(true));

async function loadGallery(force = false) {
  if (!force) galleryGrid.innerHTML = '<div class="gallery-empty">جارٍ التحميل...</div>';
  const data = await apiCall('/api/gallery');
  if (!data.ok) {
    galleryGrid.innerHTML = `<div class="gallery-empty">${DEGRADED ? 'المعرض يتطلب اتصالاً بالخادم.' : 'فشل تحميل المعرض: ' + escapeHtml(data.error || '')}</div>`;
    return;
  }
  if (!data.items || data.items.length === 0) {
    galleryGrid.innerHTML = '<div class="gallery-empty">لا توجد صور منشورة بعد. كن أول من ينشر صورة!</div>';
    return;
  }
  galleryGrid.innerHTML = '';
  for (const it of data.items) {
    const liked = it.likedBy && it.likedBy.includes(USER_ID);
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.innerHTML = `
      <img src="data:image/png;base64,${it.imageBase64}" alt="${escapeHtml(it.prompt)}" data-full="data:image/png;base64,${it.imageBase64}">
      <div class="gallery-card-meta">
        <div class="gallery-card-prompt">${escapeHtml(it.prompt)}</div>
        <div class="gallery-card-info">
          <span>${new Date(it.publishedAt).toLocaleString('ar-EG')}</span>
          <button class="like-btn ${liked ? 'liked' : ''}" data-id="${it.id}">♥ <span class="like-count">${it.likes || 0}</span></button>
        </div>
      </div>`;
    card.querySelector('img').addEventListener('click', () => openFullImage(card.querySelector('img').dataset.full));
    card.querySelector('.like-btn').addEventListener('click', (e) => toggleGalleryLike(e.currentTarget, it.id));
    galleryGrid.appendChild(card);
  }
}

async function toggleGalleryLike(btn, id) {
  btn.disabled = true;
  const data = await apiCall(`/api/gallery/${id}/like`, { method: 'POST' });
  if (data.ok) {
    btn.classList.toggle('liked', data.liked);
    btn.querySelector('.like-count').textContent = data.likes;
  } else toast(`فشل: ${data.error}`, 'error');
  btn.disabled = false;
}

// ============================================================
// PYTHON EXECUTION (requires backend)
// ============================================================
const pythonCode = document.getElementById('pythonCode');
const pythonRun = document.getElementById('pythonRun');
const pythonOutput = document.getElementById('pythonOutput');

pythonRun.addEventListener('click', async () => {
  const code = pythonCode.value;
  if (!code.trim()) { toast('اكتب كود Python', 'error'); return; }
  setLoading(pythonRun);
  pythonOutput.textContent = 'جاري التنفيذ...';
  pythonOutput.classList.remove('stderr');
  const data = await apiCall('/api/python-execution', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }, { timeout: 20000 }); // 20s for python (sandbox is 5s + overhead)
  if (data.ok) {
    let out = '';
    if (data.stdout) out += data.stdout;
    if (data.stderr) out += (out ? '\n[stderr]\n' : '') + data.stderr;
    if (data.exitCode != null && data.exitCode !== 0) out += `\n[exit ${data.exitCode}]`;
    if (!out) out = '(لا مخرجات)';
    pythonOutput.textContent = out;
    if (data.stderr) pythonOutput.classList.add('stderr');
  } else {
    pythonOutput.textContent = `خطأ: ${data.error}`;
    pythonOutput.classList.add('stderr');
  }
  resetBtn(pythonRun);
});

// ============================================================
// CONTAINER PYTHON (requires backend)
// ============================================================
const containerCode = document.getElementById('containerCode');
const containerRun = document.getElementById('containerRun');
const containerOutput = document.getElementById('containerOutput');
const contFileName = document.getElementById('contFileName');
const contFileContent = document.getElementById('contFileContent');
const contAddFile = document.getElementById('contAddFile');
const containerFiles = document.getElementById('containerFiles');
const containerFileMap = new Map();

contAddFile.addEventListener('click', () => {
  const name = contFileName.value.trim();
  const content = contFileContent.value;
  if (!name) { toast('أدخل اسم الملف', 'error'); return; }
  containerFileMap.set(name, content);
  contFileName.value = '';
  contFileContent.value = '';
  renderContainerFiles();
});

function renderContainerFiles() {
  containerFiles.innerHTML = '';
  for (const [name] of containerFileMap) {
    const chip = document.createElement('span');
    chip.className = 'file-chip';
    chip.innerHTML = `📄 ${escapeHtml(name)} <button aria-label="حذف">×</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      containerFileMap.delete(name);
      renderContainerFiles();
    });
    containerFiles.appendChild(chip);
  }
}

containerRun.addEventListener('click', async () => {
  const code = containerCode.value;
  if (!code.trim()) { toast('اكتب كود Python', 'error'); return; }
  setLoading(containerRun);
  containerOutput.textContent = 'جاري تنفيذ الحاوية...';
  containerOutput.classList.remove('stderr');
  const files = Object.fromEntries(containerFileMap);
  const data = await apiCall('/api/container/python-execution', {
    method: 'POST',
    body: JSON.stringify({ code, files }),
  }, { timeout: 20000 });
  if (data.ok) {
    let out = '';
    if (data.stdout) out += data.stdout;
    if (data.stderr) out += (out ? '\n[stderr]\n' : '') + data.stderr;
    if (data.exitCode != null && data.exitCode !== 0) out += `\n[exit ${data.exitCode}]`;
    if (data.workDir) out += `\n[workDir: ${data.workDir}]`;
    if (!out) out = '(لا مخرجات)';
    containerOutput.textContent = out;
    if (data.stderr) containerOutput.classList.add('stderr');
  } else {
    containerOutput.textContent = `خطأ: ${data.error}`;
    containerOutput.classList.add('stderr');
  }
  resetBtn(containerRun);
});

// ============================================================
// FILE SEARCH (requires backend)
// ============================================================
const fsQuery = document.getElementById('fsQuery');
const fsSearch = document.getElementById('fsSearch');
const fsResult = document.getElementById('fsResult');

fsSearch.addEventListener('click', async () => {
  const q = fsQuery.value.trim();
  if (!q) { toast('اكتب استعلام البحث', 'error'); return; }
  setLoading(fsSearch);
  fsResult.textContent = 'جاري البحث في فهرس الملفات...';
  const data = await apiCall('/api/container/file-search', {
    method: 'POST',
    body: JSON.stringify({ query: q }),
  });
  if (data.ok) {
    if (!data.results || data.results.length === 0) {
      fsResult.textContent = `لا نتائج (الفهرس الكلي: ${data.total} ملف).\nملاحظة: ارفع ملفات أولاً من تبويب "حاوية Python".`;
    } else {
      fsResult.textContent = `النتائج (${data.results.length} من ${data.total}):\n` +
        data.results.map((r) => `• ${r.name} (${r.size} bytes)`).join('\n');
    }
  } else {
    fsResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(fsSearch);
});

// ============================================================
// BROWSER SEARCH
// ============================================================
const bsQuery = document.getElementById('bsQuery');
const bsSearch = document.getElementById('bsSearch');
const bsResult = document.getElementById('bsResult');

bsSearch.addEventListener('click', async () => {
  const q = bsQuery.value.trim();
  if (!q) { toast('اكتب استعلام البحث', 'error'); return; }
  setLoading(bsSearch);
  bsResult.textContent = 'جاري البحث في الويب...';
  const data = await apiCall('/api/browser/search', {
    method: 'POST',
    body: JSON.stringify({ query: q }),
  });
  if (data.ok) {
    bsResult.textContent = JSON.stringify(data.results, null, 2);
  } else {
    bsResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(bsSearch);
});

// ============================================================
// INTERNAL CONTENT SEARCH (was Meta 1P)
// ============================================================
const msQuery = document.getElementById('msQuery');
const msSearch = document.getElementById('msSearch');
const msResult = document.getElementById('msResult');

msSearch.addEventListener('click', async () => {
  const q = msQuery.value.trim();
  if (!q) { toast('اكتب استعلام البحث', 'error'); return; }
  setLoading(msSearch);
  msResult.textContent = 'جاري البحث في المحتوى الداخلي...';
  const data = await apiCall('/api/meta-1p/content-search', {
    method: 'POST',
    body: JSON.stringify({ query: q }),
  });
  if (data.ok) {
    msResult.textContent = JSON.stringify(data.results, null, 2);
  } else {
    msResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(msSearch);
});

// ============================================================
// P13N USER CONTEXT
// ============================================================
const p13nLang = document.getElementById('p13nLang');
const p13nTheme = document.getElementById('p13nTheme');
const p13nInterest = document.getElementById('p13nInterest');
const p13nSave = document.getElementById('p13nSave');
const p13nResult = document.getElementById('p13nResult');

async function loadP13n() {
  const data = await apiCall('/api/p13n/user-context');
  if (data.ok && data.context) {
    const c = data.context;
    p13nResult.textContent = `السياق الحالي:\n${JSON.stringify(c, null, 2)}`;
    if (c.preferences) {
      if (c.preferences.language) p13nLang.value = c.preferences.language;
      if (c.preferences.theme) p13nTheme.value = c.preferences.theme;
    }
  } else if (DEGRADED) {
    p13nResult.textContent = 'يتطلب اتصالاً بالخادم لحفظ السياق.';
  }
}

p13nSave.addEventListener('click', async () => {
  setLoading(p13nSave);
  const interest = p13nInterest.value.trim();
  const update = { preferences: { language: p13nLang.value, theme: p13nTheme.value } };
  if (interest) update.interest = interest;
  const data = await apiCall('/api/p13n/user-context', {
    method: 'POST',
    body: JSON.stringify({ update }),
  });
  if (data.ok && data.context) {
    p13nResult.textContent = `تم الحفظ. السياق:\n${JSON.stringify(data.context, null, 2)}`;
    if (interest) p13nInterest.value = '';
    toast('تم حفظ التفضيلات', 'success');
  } else {
    toast(`فشل: ${data.error}`, 'error');
  }
  resetBtn(p13nSave);
});

// ============================================================
// TECHNICAL SUPPORT (was Maisa Support)
// ============================================================
const maisaQuery = document.getElementById('maisaQuery');
const maisaContext = document.getElementById('maisaContext');
const maisaSend = document.getElementById('maisaSend');
const maisaResult = document.getElementById('maisaResult');

maisaSend.addEventListener('click', async () => {
  const q = maisaQuery.value.trim();
  if (!q) { toast('اكتب استفسارك', 'error'); return; }
  setLoading(maisaSend);
  maisaResult.textContent = 'جاري معالجة الاستفسار...';
  let context = {};
  try { context = JSON.parse(maisaContext.value); }
  catch { if (maisaContext.value.trim()) context = { text: maisaContext.value }; }
  const data = await apiCall('/api/maisa/support', {
    method: 'POST',
    body: JSON.stringify({ query: q, context }),
  });
  if (data.ok) {
    maisaResult.textContent = data.response || JSON.stringify(data, null, 2);
  } else {
    maisaResult.textContent = `خطأ: ${data.error}`;
  }
  resetBtn(maisaSend);
});

// ============================================================
// Boot — auto-discover backend, no settings needed
// ============================================================
(async function init() {
  try {
    await initConfig();
    renderSubTabs();
    switchPanel('chat');
    await autoDiscoverBackend();
  } catch (e) {
    console.error('Boot error:', e);
    toast('خطأ في الإقلاع: ' + friendlyError(e), 'error');
  }
})();
