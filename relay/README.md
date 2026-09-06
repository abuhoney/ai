# Z.AI Relay Server (Fly.io)

خادم وسيط يعمل على Fly.io في منطقة هونغ كونغ (hkg) لتوصيل طلبات BardomPro backend بـ Z.AI APIs.

## لماذا نحتاجه؟

Z.AI يستخدم `internal-api.z.ai` الذي يحلّ لعناوين IP داخلية (172.25.x.x) خاصة بشبكة Alibaba Cloud HK. خوادم Render (USA) لا تستطيع الوصول لها.

هذا الـ relay يعمل من HK ويستطيع الوصول لـ Z.AI مباشرة.

## الملفات

```
relay/
├── server.js       # خادم Express بسيط (proxy)
├── package.json    # التبعيات (express, cors فقط)
├── fly.toml        # إعداد Fly.io (region = hkg)
├── Dockerfile      # صورة Node.js 20 Alpine
└── .gitignore
```

## Endpoints

| Endpoint | الوصف |
|----------|-------|
| `GET /healthz` | فحص الصحة |
| `POST /video/generation` | إنشاء مهمة فيديو (CogVideoX) |
| `GET /async-result/:id` | اقتراع نتيجة المهمة |
| `POST /images/generations` | توليد صورة |
| `POST /images/generations/edit` | تعديل صورة (img2img) |
| `POST /chat/completions/vision` | تحليل صورة |
| `POST /chat/completions` | محادثة نصية |
| `POST /audio/tts` | تحويل نص لصوت |

## النشر على Fly.io

### 1) إنشاء حساب (مجاني، 30 ثانية)
اذهب إلى https://fly.io/app/sign-up وسجّل بالـ GitHub

### 2) تثبيت flyctl CLI
```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Windows
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### 3) تسجيل الدخول
```bash
flyctl auth login
```

### 4) إنشاء التطبيق (من مجلد relay/)
```bash
cd relay
flyctl launch --no-deploy
# اختر: Yes لـ "Copy existing configuration"
# اسم التطبيق: zai-relay (أو أي اسم)
# المنطقة: hkg (Hong Kong)
```

### 5) إضافة الأسرار (Secrets)
```bash
flyctl secrets set \
  ZAI_BASE_URL="https://internal-api.z.ai/v1" \
  ZAI_API_KEY="Z.ai" \
  ZAI_CHAT_ID="d5a5dfcd-27e7-4d4a-b56f-13313900eae7" \
  ZAI_USER_ID="ef2ad49b-23e9-4c2d-8b13-6ff693f5dd90" \
  ZAI_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZWYyYWQ0OWItMjNlOS00YzJkLThiMTMtNmZmNjkzZjVkZDkwIiwiY2hhdF9pZCI6ImNoYXQtMGE5MWIzMmYtOWQ2Yi00NzZiLTg1ZmItNmZhMmNlYWE5Y2JmIiwicGxhdGZvcm0iOiJ6YWkifQ.tVpZjm40XWjVQjHkCAqz0yB0a4xDRD1_eo3e6o6otxU"
```

### 6) النشر
```bash
flyctl deploy
```

### 7) الحصول على الرابط
```bash
flyctl apps list
# سترى: zai-relay.fly.dev
```

### 8) اختبار
```bash
curl https://zai-relay.fly.dev/healthz
```

## الأمان والخصوصية

- ✅ **المفاتيح في `fly secrets`** — لا تُرفع لـ GitHub أبداً
- ✅ **الكود عام** — لا يحتوي على أي مفاتيح
- ✅ **لا قاعدة بيانات** — الـ relay لا يخزن أي بيانات، فقط يمرر الطلبات
- ✅ **HTTPS إلزامي** — Fly.io يوفّر شهادة SSL تلقائياً
- ✅ **الـ relay يستقبل الطلبات فقط من Render backend** (يمكن تقييده بـ IP)

## التكلفة

- ✅ **مجاني** ضمن خطة Fly.io المجانية (3 shared VMs, 256MB RAM)
- الـ relay خفيف جداً (~50MB RAM مستخدمة)
- ساعات المعالجة المطلوبة قليلة (فقط عند توليد فيديو)
