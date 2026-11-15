"use client";
import { useState } from "react";
import { ApiError, api, type User } from "@/lib/api";
import { Brand, Spinner, ThemeToggle } from "./common";

const FEATURES = [
  { t: "EXE حقيقي لويندوز", d: "بناء عبر MinGW-w64 داخل بيئة معزولة، ونتحقق من ترويسة PE قبل تسميته EXE." },
  { t: "تشغيل ومعاينة من المتصفح", d: "شغّل برامج Console والواجهات الرسومية في Windows Runner معزول وتفاعل معها." },
  { t: "أخطاء مشروحة بالعربية", d: "كل خطأ مترجم يظهر في مكانه بالكود مع شرح عربي واقتراح إصلاح." },
  { t: "من المبتدئ إلى المحترف", d: "دروس وتمارين، ثم CMake وMakefile وخيارات المترجم ومعايير C++17 حتى C++26." },
];

export function AuthScreen({ onAuthed }: { onAuthed: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = mode === "login" ? await api.login(email, password) : await api.register(email, name, password);
      onAuthed(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.messageAr : "تعذّر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between px-5 py-4">
        <Brand />
        <ThemeToggle />
      </header>
      <main className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-6 lg:grid-cols-[1.2fr_1fr] lg:pt-14">
        <section>
          <p className="chip mb-4 border-accent/40 text-accent">بيئة تطوير C++ عربية في المتصفح</p>
          <h1 className="text-3xl font-bold leading-[1.35] sm:text-5xl sm:leading-[1.3]">
            اكتب C++، اضغط <span className="text-accent">بناء</span>، واحصل على
            <bdi dir="ltr" className="mx-2 font-mono text-teal">.exe</bdi>
            حقيقي.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-ink-2">
            لا Visual Studio ولا تثبيت. حرّر مشروعك من الجوال أو الكمبيوتر، ابنِه على خوادم معزولة، نزّل الملف التنفيذي أو شغّله وعاينه مباشرة.
          </p>
          <div className="mt-8 rounded-xl border border-line bg-surface p-4 font-mono text-[13px] leading-6" dir="ltr">
            <div className="text-ink-3">$ build --target windows-exe --std c++20</div>
            <div className="text-ink-2">x86_64-w64-mingw32-g++ main.cpp -o app.exe</div>
            <div className="text-ok">✔ app.exe — PE32+ executable (console) x86-64</div>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.t} className="border-s-2 border-accent/60 ps-3">
                <div className="font-semibold">{f.t}</div>
                <div className="mt-1 text-sm leading-6 text-ink-2">{f.d}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="self-start rounded-2xl border border-line bg-surface p-6 shadow-xl">
          <div className="mb-5 flex rounded-lg border border-line p-1 text-sm" role="tablist">
            {(["login", "register"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-md py-2 font-semibold ${mode === m ? "bg-surface-3 text-ink" : "text-ink-3"}`}>
                {m === "login" ? "تسجيل الدخول" : "حساب جديد"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <label className="block text-sm">
                <span className="mb-1 block text-ink-2">الاسم</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
              </label>
            )}
            <label className="block text-sm">
              <span className="mb-1 block text-ink-2">البريد الإلكتروني</span>
              <input className="field text-start" dir="ltr" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-ink-2">كلمة المرور {mode === "register" && <span className="text-ink-3">(8 أحرف على الأقل)</span>}</span>
              <input className="field text-start" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </label>
            {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button className="btn btn-primary w-full justify-center py-2.5" disabled={busy}>
              {busy && <Spinner />} {mode === "login" ? "دخول" : "إنشاء الحساب"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
