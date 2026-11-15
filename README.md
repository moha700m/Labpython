# Muhammad C++ Studio

منصة تطوير C++ عربية تعمل من المتصفح (الكمبيوتر والجوال): أنشئ مشروعاً أو ارفعه، حرّر الكود في محرر احترافي، اضغط **بناء** لتحصل على ملف **Windows EXE حقيقي**، ثم نزّله أو شغّله وتفاعل معه من المتصفح.

> An Arabic-first, browser-based C++ IDE: edit, build real Windows `.exe` files on isolated workers, download them, or run and interact with them from the browser.

![IDE](docs/screenshots/05-run-terminal.png)

## ما الذي يعمل الآن (مُختبر فعلياً)

| الميزة | الحالة |
|---|---|
| واجهة عربية RTL كاملة، داكن/فاتح، متجاوبة مع الجوال | ✅ |
| حسابات، مشاريع، ملفات متعددة، تبويبات، حفظ تلقائي | ✅ |
| رفع ZIP / مجلد / ملفات مع حماية من Path Traversal وZIP bombs والروابط الرمزية | ✅ |
| محرر Monaco: تلوين، إكمال تلقائي لـ C++، تنسيق (clang-format)، بحث واستبدال، اختصارات | ✅ |
| بناء GCC وClang (Linux ELF) وMinGW-w64 (Windows PE32+ EXE حقيقي) | ✅ |
| C++17 / 20 / 23، و C++26 حسب دعم المترجم (Clang 18 نعم، GCC 13 لا — مع شرح) | ✅ |
| ملف واحد، ملفات متعددة، CMake، Makefile، مكتبات ساكنة وديناميكية، ملفات .rc | ✅ |
| سجل بناء حي، نسبة تقدم، وقت، حجم، SHA-256، صيغة الملف المكتشفة من الترويسة | ✅ |
| الأخطاء والتحذيرات داخل الكود مع شرح عربي واقتراح إصلاح | ✅ |
| تنزيل EXE | ✅ |
| تشغيل برامج Console تفاعلياً من المتصفح (Linux معزول، أو EXE عبر Windows Runner) | ✅ |
| معاينة حية لبرامج Win32 الرسومية مع الماوس ولوحة المفاتيح ولقطة شاشة | ✅ (عبر Wine، انظر الملاحظات) |
| وضع تعليمي: دروس وتمارين يُتحقق منها بالبناء والتشغيل الفعلي | ✅ |
| مساعد ذكاء اصطناعي عربي بموافقة على كل تعديل (عرض الفروقات) | ✅ مبني — يحتاج مفتاح مزوّد على الخادم |
| Debugging / Breakpoints / Profiling / Git | ⏳ لم يُنفّذ بعد (الزر معطّل ومعلَن كذلك) |
| MSVC وWindows Worker أصلي | ⏳ موثّق فقط — يحتاج بنية Windows |

**ملاحظة صريحة عن «Windows Runner»:** التشغيل الحالي يتم عبر **Wine** داخل صندوق رمل على عامل Linux، وليس على نظام Windows حقيقي. ملفات EXE نفسها أصلية (PE32+) وتعمل على Windows، لكن Wine لا يغطي كل واجهات Windows. تصميم العامل الأصلي على Windows موثّق في [`workers/windows-runner/README.md`](workers/windows-runner/README.md).

## البدء السريع (تطوير محلي)

المتطلبات: Node.js 22.12+، pnpm 10، و(للبناء والتشغيل) `bubblewrap g++ clang cmake g++-mingw-w64-x86-64-posix` و(اختياري) `wine xvfb xdotool imagemagick clang-format`.

```bash
pnpm install
pnpm --filter @mcs/web build                      # واجهة ثابتة
MCS_WEB_DIR=$PWD/apps/web/out pnpm --filter @mcs/api start   # http://localhost:4000
# في طرفية أخرى (الرمز يُنشأ تلقائياً في .data/worker-token أثناء التطوير):
export MCS_WORKER_TOKEN=$(cat apps/api/.data/worker-token)
pnpm --filter @mcs/linux-builder start
pnpm --filter @mcs/windows-runner start
```

التفاصيل في [DEVELOPMENT.md](DEVELOPMENT.md)، النشر في [DEPLOYMENT.md](DEPLOYMENT.md)، المعمارية في [ARCHITECTURE.md](ARCHITECTURE.md)، الأمن في [SECURITY.md](SECURITY.md)، وحالة المشروع في [PROJECT_STATE.md](PROJECT_STATE.md).

## الاختبارات

```bash
pnpm lint && pnpm typecheck
pnpm test:unit          # منطق خالص
pnpm test:security      # عزل المستخدمين، هجمات الرفع، حدود الصندوق الرملي
pnpm test:integration   # بناء وتشغيل حقيقي عبر API + العمال
node tests/e2e/run-e2e.mjs   # واجهة حقيقية عبر Playwright (يتطلب تشغيل المكدّس)
```

## البنية

```
apps/api            Fastify API: مصادقة، مشاريع، طابور مهام، تخزين ملفات ناتجة، ترحيل جلسات التشغيل
apps/web            Next.js (تصدير ثابت) + Tailwind + Monaco
packages/shared     الأنواع، فحص المسارات، ZIP الآمن، كشف صيغة الملفات التنفيذية
packages/compiler   تخطيط البناء، قائمة الخيارات المسموحة، تحليل رسائل المترجم
packages/localization  النصوص العربية وشرح الأخطاء
packages/worker-runtime  الصندوق الرملي (bubblewrap)، بروتوكول العامل، جلسات التشغيل
workers/linux-builder   عامل البناء (GCC/Clang/MinGW) + تشغيل Linux
workers/windows-runner  عامل تشغيل EXE (Wine + Xvfb) ووثائق العامل الأصلي
workers/windows-builder وثائق عامل MSVC (غير منفّذ)
templates/          قوالب المشاريع
infrastructure/docker  Dockerfiles و docker-compose
tests/              unit / security / integration / e2e
```

## الرخصة

لا توجد رخصة في المستودع بعد — اختيارها قرار مالك المشروع. المكتبات الخارجية المستخدمة وتراخيصها مذكورة في [SECURITY.md](SECURITY.md#third-party-components).
