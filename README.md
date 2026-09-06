# BardomPro AI v3.0 — مدعوم بالكامل بـ Z.AI الأصلية (14 قدرة)

**الإصدار 3.0.0 (No-Settings Edition)** — توسعة كاملة لـ `z-ai-web-dev-sdk@0.0.18` مع 14 قدرة موزّعة على 3 فئات: الذكاء، الوسائط، الأدوات.

## ✨ يعمل مباشرة — بدون إعدادات!

لا حاجة لأي إعدادات يدوية. التطبيق:
1. **يكتشف الـ backend تلقائياً** — يجرب Render أولاً، ثم قائمة fallback (localhost, 10.0.2.2, إلخ)
2. **يدخل "وضع محدود" (degraded mode)** بأناقة إذا فشل كل الـ backends — يظهر banner سفلي مع زر إعادة محاولة
3. **يعطّل القدرات التي تتطلب backend** (Python, file-search) في الوضع المحدود مع رسالة واضحة
4. **يبقى بقية القدرات متاحة** للمحاولة عند عودة الـ backend

## القدرات الـ14

### 🧠 الذكاء (Intelligence)
| القدرة | المسار | الوصف |
|---|---|---|
| `chat` | POST `/api/chat` | محادثة عبر GLM-4-Plus |
| `vision` | POST `/api/vision` | تحليل الصور عبر GLM-4V |
| `p13n_tool.get_user_context` | POST/GET `/api/p13n/user-context` | سياق المستخدم للتخصيص |
| `maisa_support_axon` ★ | POST `/api/maisa/support` | دعم فني عبر Maisa (اختياري) |

### 🎨 الوسائط (Media)
| القدرة | المسار | الوصف |
|---|---|---|
| `media.create_image` | POST `/api/media/create-image` | توليد الصور عبر Z.AI |
| `media.create_video` | POST `/api/media/create-video` | توليد الفيديو (غير متزامن) |
| `media.animate_image` | POST `/api/media/animate-image` | تحريك صورة |
| `media.edit_image` | POST `/api/media/edit-image` | تعديل صورة (img2img) |
| `media.edit_video` | POST `/api/media/edit-video` | تعديل فيديو |
| `media.get_audio` ★ | POST `/api/media/get-audio` | استخراج صوت (اختياري) |
| `media.get_reference_image` | POST `/api/media/get-reference-image` | صورة مرجعية عبر البحث |

### 🛠️ الأدوات (Tools)
| القدرة | المسار | الوصف |
|---|---|---|
| `python_execution` | POST `/api/python-execution` | تنفيذ Python في sandbox آمن |
| `container.python_execution` | POST `/api/container/python-execution` | حاوية معزولة + ملفات |
| `container.file_search` | POST `/api/container/file-search` | بحث في فهرس الملفات |
| `browser.search` | POST `/api/browser/search` | بحث ويب عبر Z.AI |
| `meta_1p.content_search` | POST `/api/meta-1p/content-search` | بحث محتوى Meta |

★ = اختياري

## البنية (v3)

```
z-ai-web-dev-sdk/
├── dist/                    # الـ SDK الأصلي (v0.0.18)
├── backend/                 # ★ Node.js/Express backend
│   ├── src/
│   │   └── server.js        # 14 endpoint كامل
│   ├── package.json         # express + cors + multer + z-ai-web-dev-sdk
│   └── README.md
├── web-app/                 # واجهة الويب المحدّثة
│   ├── index.html            # 3 فئات + تبويبات فرعية
│   ├── app.js                # منطق كل قدرة
│   ├── style.css             # Dark Glassmorphism + RTL
│   └── config.json           # الإعدادات
├── android/                 # مشروع Android WebView (v3.0.0)
│   └── app/src/main/
│       ├── assets/web/       # نسخة من web-app/ (للعمل offline)
│       └── java/com/bardompro/zai/MainActivity.java
├── .z-ai-config             # تكوين Z.AI
├── BardomPro-AI-v2.apk      # النسخة السابقة للمرجعية
└── README.md
```

## التشغيل محلياً

```bash
cd z-ai-web-dev-sdk/backend
npm install
PORT=3000 node src/server.js
```

ثم افتح `web-app/index.html` في المتصفح — سيعمل مباشرة! التطبيق سيكتشف localhost:3000 تلقائياً.

## النشر على Render

1. اربط الـ repo بـ Render كـ Web Service
2. Root Directory: `z-ai-web-dev-sdk/backend`
3. Build Command: `npm install`
4. Start Command: `node src/server.js`
5. متغيّر البيئة `PORT` يُضبط تلقائياً

## أمان Python Sandbox

`python_execution` و `container.python_execution` يستخدمان:
- `python3 -I -S` (تجاهل site-packages ووصول النظام)
- timeout صارم 5 ثوانٍ (MAX_PYTHON_TIMEOUT)
- maxBuffer 1MB (لمنع استهلاك الذاكرة)
- إزالة متغيّرات HTTP_PROXY/HTTPS_PROXY
- مجلد عمل مؤقت (للـ container فقط)

## تصميم الواجهة

- **Dark Glassmorphism**: خلفية `#070b18` + بطاقات زجاجية بـ `backdrop-filter: blur(14px)`
- **Aurora animated background**: 3 blobs متحركة بألوان متدرجة
- **Live connection pill**: مؤشّر اتصال حي (أخضر/أصفر/أحمر) في الهيدر
- **RTL-first**: خط Noto Sans Arabic، تخطيط من اليمين لليسار
- **SVG icons**: بدلاً من الإيموجي للأيقونات الرئيسية
- **Micro-animations**: انتقالات بين التبويبات + toast أنيق + loaders

## الـ SDK المستخدم

`z-ai-web-dev-sdk@0.0.18` — الحزمة الرسمية من Z AI، تستورد بـ:

```js
import ZAI from 'z-ai-web-dev-sdk';
const zai = await ZAI.create();
// zai.chat.completions.create(...)
// zai.images.generations.create(...)
// zai.video.generations.create(...)
// zai.images.search.create(...)
// zai.functions.invoke(name, args)
```
