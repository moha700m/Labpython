/** UI strings (Arabic first). Keys are stable; English is kept for logs/tooltips. */
export const ar = {
  appName: "Muhammad C++ Studio",
  tagline: "استوديو C++ عربي في متصفحك — اكتب، ابنِ EXE حقيقياً، وشغّل.",
  build: "بناء",
  run: "تشغيل",
  debug: "تصحيح",
  exportExe: "تصدير EXE",
  stop: "إيقاف",
  newProject: "مشروع جديد",
  openProject: "فتح مشروع",
  uploadZip: "رفع ZIP",
  uploadFolder: "رفع مجلد",
  uploadFiles: "رفع ملفات",
  problems: "المشكلات",
  buildLog: "سجل البناء",
  terminal: "الطرفية",
  preview: "المعاينة",
  assistant: "المساعد الذكي",
  explorer: "المستكشف",
  settings: "الإعدادات",
  beginnerMode: "وضع المبتدئ",
  proMode: "وضع المحترف",
  notAvailable: "غير متاح بعد",
  phase: {
    queued: "في الطابور",
    preparing: "تجهيز بيئة البناء",
    compiling: "الترجمة",
    linking: "الربط",
    configuring: "تهيئة CMake",
    packaging: "تجهيز الملف الناتج",
    done: "اكتمل",
    failed: "فشل",
    cancelled: "أُلغي",
  },
  status: {
    queued: "في الانتظار",
    running: "قيد التنفيذ",
    succeeded: "نجح",
    failed: "فشل",
    cancelled: "أُلغي",
  },
} as const;

export function formatBytesAr(n: number): string {
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} كيلوبايت`;
  return `${(n / 1024 / 1024).toFixed(2)} ميغابايت`;
}

export function formatDurationAr(ms: number): string {
  if (ms < 1000) return `${ms} ملّي ثانية`;
  return `${(ms / 1000).toFixed(2)} ثانية`;
}
