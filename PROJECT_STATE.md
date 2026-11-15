# PROJECT_STATE — Muhammad C++ Studio

_آخر تحديث: 2026-11-15 — الفرع `claude/muhammad-cpp-studio-w49fh8`_

## 1. فحص المستودع (قبل كتابة أي كود)

| البند | النتيجة |
|---|---|
| المستودع | `moha700m/Labpython` |
| الفرع `main` | **غير موجود على الخادم** — المستودع فارغ تماماً (لا commits ولا ملفات) |
| الملفات/الإعدادات الموجودة | لا شيء — لم يُستبدل أو يُحذف أي عمل سابق |
| الرخصة | لم تكن موجودة — **أُضيفت MIT** بطلب المالك |
| كود خارجي | لا يوجد كود منسوخ؛ كل الاعتماديات من npm أو حزم النظام، وتراخيصها في SECURITY.md |
| البيئة المتاحة للتطوير | Ubuntu 24.04، Node 22، GCC 13، Clang 18، CMake، bubblewrap 0.9، MinGW-w64 13 و Wine 9 (ثُبّتا خلال العمل)، Docker |

## 2. خطة التنفيذ والحالة

| المرحلة | الحالة | ملاحظات |
|---|---|---|
| **1 Foundation** | ✅ مكتملة | Monorepo، Next.js + Tailwind + Monaco، لوحة المشاريع، القوالب، رفع ZIP/مجلد/ملفات، المستكشف، التبويبات، الحفظ التلقائي، RTL، داكن/فاتح، الجوال |
| **2 Compiler** | ✅ مكتملة | API مستقل، مصادقة، طابور مهام في SQLite موجّه بالقدرات، Linux Builder، GCC + Clang، سجلات حية، تشخيص عربي |
| **3 Windows EXE** | ✅ مكتملة (MinGW) | EXE حقيقي PE32+ عبر MinGW-w64، فحص الترويسة قبل التسمية، تخزين وتنزيل مع SHA-256. **MSVC غير منفّذ** (يحتاج Windows) |
| **4 Live Preview** | ✅ عبر Wine | Windows Runner معزول، جلسة وبادئة Wine جديدة لكل تشغيل، بث إطارات JPEG عبر WebSocket، ماوس ولوحة مفاتيح، لقطة شاشة، إيقاف، تنظيف. **العامل الأصلي على Windows غير منفّذ** |
| **5 AI Assistant** | ✅ مبني ومختبر بمزوّد وهمي | Claude عبر SDK الرسمي، مفتاح على الخادم فقط، اقتراحات مع عرض فروقات وموافقة صريحة. **لم يُختبر مع مفتاح حقيقي** (لا يوجد مفتاح في هذه البيئة ولا نطلبه في المحادثة) |
| **6 Professional Tools** | 🟡 جزئي | منفّذ: خيارات المترجم (قائمة مسموحة)، Debug/Release، متغيرات البيئة، مكتبات، CMake/Make. **غير منفّذ**: Debugger/Breakpoints/Call stack/Memory، Profiling، Git، إدارة الاعتماديات، CMake Presets — الأزرار معطّلة ومعلَن ذلك |
| **7 Production** | 🟡 جزئي | اختبارات شاملة + مراجعة أمنية + CI + Dockerfiles + docs + **GitHub Codespaces** (`.devcontainer/`) لتشغيل المنصة كاملة على GitHub. لا يوجد خادم عام دائم؛ مهمة deploy تعمل فقط عند إضافة `DEPLOY_HOOK_URL` |
| **إضافة: صفحة /run/** | ✅ | ارفع ملف ← بناء EXE ← تشغيل وتحكم ← تنزيل، مع كشف WinMain تلقائياً |

## 3. الاختبارات التي شُغّلت فعلياً ونتائجها

كل ما يلي شُغّل في هذه البيئة على المكدّس الحقيقي (API + عمال حقيقيون + bubblewrap + MinGW + Wine)، بدون محاكاة.

| # | الاختبار المطلوب | الحالة | الدليل |
|---|---|---|---|
| 1 | إنشاء مشروع | ✅ | E2E «create project from console template» |
| 2 | رفع مشروع ZIP | ✅ | `tests/security/api.test.ts` (استيراد ZIP) |
| 3 | فتح ملفات متعددة | ✅ | integration multi-file + E2E |
| 4 | تعديل وحفظ الكود | ✅ | E2E (تعديل → بناء يرى التعديل) |
| 5 | بناء مشروع بسيط | ✅ | integration + E2E |
| 6 | بناء مشروع متعدد الملفات | ✅ | integration |
| 7 | بناء CMake | ✅ | integration (CMake → PE32+) |
| 8 | عرض الأخطاء | ✅ | E2E: خطأ «فاصلة منقوطة» بالعربية في لوحة المشكلات وداخل المحرر |
| 9 | إنتاج EXE حقيقي | ✅ | فحص `MZ` + `PE\0\0` + magic `0x20b` في integration وE2E، و `file`: «PE32+ executable (console) x86-64, for MS Windows» |
| 10 | تنزيل EXE | ✅ | E2E يُنزّل ويفحص الترويسة واسم الملف |
| 11 | تشغيل EXE داخل Windows Worker | ✅ (Wine) | integration + E2E: إدخال «Muhammad» → «مرحباً Muhammad!» |
| 12 | بث المعاينة إلى المتصفح | ✅ (Wine) | E2E + integration: إطارات JPEG |
| 13 | التفاعل مع البرنامج | ✅ | E2E: النقر على الزر يغيّر الإطار؛ اختبار يدوي: 3 نقرات → «Clicks: 3» |
| 14 | إيقاف جلسة التشغيل | ✅ | integration (stop) + إيقاف تلقائي بعد 60 ث بلا مشاهد |
| 15 | Safari على iPhone | ⚠️ محاكاة فقط | Playwright بملف «iPhone 15 Pro» على **Chromium** (المقاس وUA والجوال) — **لم يُختبر على Safari/WebKit حقيقي** |
| 16 | حدود الموارد | ✅ | CPU، المهلة، الذاكرة، حجم الملفات، فيض المخرجات، fork bomb |
| 17 | عزل المستخدمين | ✅ | مستخدم B لا يصل لمشاريع/ملفات/مهام A (404) |
| 18 | الملفات الخبيثة وتجاوز المسارات | ✅ | `../`، مسارات مطلقة، روابط رمزية في ZIP، ZIP bomb، ملفات EXE، خيارات مترجم خطرة |

أوامر وأرقام آخر تشغيل:

```
pnpm lint            → 0 errors
pnpm typecheck       → 8/8 packages OK
npx vitest run       → 11 files, 101 tests passed (54 unit, 27 security, 20 integration)
node tests/e2e/run-e2e.mjs → 12/12 steps passed (desktop 1440×900 + iPhone 15 Pro viewport, incl. /run/)
devcontainer (typescript-node:22-bookworm, privileged, non-root) → setup.sh + start.sh OK,
  6 worker capabilities online, console-app → PE32+ EXE → Wine 8 run with Arabic output OK
pnpm --filter @mcs/web build → static export OK
```

لقطات الشاشة من تشغيل E2E: `docs/screenshots/`.

## 4. حدود معروفة (بصراحة)

1. **Windows Runner = Wine** على Linux، وليس Windows حقيقياً. ملفات EXE أصلية، لكن بعض واجهات Windows غير مدعومة في Wine.
2. **MSVC** غير متاح (يحتاج عامل Windows) — موثّق في `workers/windows-builder/README.md`.
3. **Debugging/Profiling/Git** غير منفّذة.
4. **IntelliSense** حالياً إكمال تلقائي مبني على قواعد (كلمات/مكتبة قياسية/معرّفات الملف) + إصلاحات سريعة من التشخيص، وليس clangd كاملاً.
5. **الطرفية** HTML بإدخال سطري (لدعم العربية بشكل صحيح)؛ برامج تقرأ ضغطات مفردة (getch) غير مدعومة جيداً.
6. **C++26**: يعتمد على المترجم — Clang 18 يدعم `-std=c++2c`، GCC/MinGW 13 لا (رسالة عربية واضحة).
7. **RLIMIT_NPROC** لا يُطبّق على root؛ الـ Dockerfiles تشغّل العمال بمستخدم غير root.
8. **Docker images**: لم يُتحقق من بنائها محلياً (شهادة وكيل HTTPS في هذه البيئة غير موثوقة داخل `docker build`)؛ مهمة CI `docker` تبنيها.
9. **apps/desktop** من البنية المقترحة لم يُنشأ — لا حاجة له حالياً (الويب يعمل على الكمبيوتر).
10. **قاعدة البيانات** SQLite لنسخة API واحدة؛ للتوسع: Postgres + S3 + Redis (DEPLOYMENT.md).

## 5. الخطوات التالية المقترحة

1. فتح Codespace فعلي من زر README والتأكد من الرابط العام (لم يُنشأ من هذه الجلسة).
2. لخادم عام دائم: VPS بـ Docker Compose وإضافة `DEPLOY_HOOK_URL` و `MCS_WORKER_TOKEN` كأسرار.
3. إضافة `ANTHROPIC_API_KEY` على الخادم لتفعيل المساعد واختباره بمفتاح حقيقي.
4. المرحلة 6: Debugger عبر gdb/MI في العامل (Linux أولاً)، ثم Git (isomorphic-git أو عبر الخادم)، ثم clangd عبر LSP لـ IntelliSense كامل.
5. اختبار يدوي على iPhone Safari حقيقي، وإضافة WebKit إلى CI.
6. عامل Windows أصلي (Hyper-V/Windows Sandbox) لـ MSVC والتشغيل الحقيقي.
