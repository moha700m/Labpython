"use client";
import { useEffect, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { CheckCircle2, ChevronLeft, FolderOpen, Play, XCircle } from "lucide-react";
import { ApiError, api, followJob, type User } from "@/lib/api";
import { RunSession } from "@/lib/run";
import { LESSONS, type Lesson } from "@/content/lessons";
import { Brand, Spinner, ThemeToggle, useTheme } from "./common";

loader.config({ paths: { vs: "/monaco/vs" } });

const norm = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

/** Keep one private practice project per lesson (id stored per browser). */
async function practiceProject(lesson: Lesson): Promise<string> {
  const key = `mcs-lesson-${lesson.id}`;
  let id: string | null = null;
  try {
    id = localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  if (id) {
    try {
      await api.project(id);
      return id;
    } catch {
      /* deleted */
    }
  }
  const { project } = await api.createProject({ name: `تمرين: ${lesson.titleAr}`, files: [{ path: "main.cpp", content: lesson.exercise.starter, encoding: "utf8" }] });
  try {
    localStorage.setItem(key, project.id);
  } catch {
    /* ignore */
  }
  return project.id;
}

type Check = { state: "idle" | "building" | "running" | "pass" | "fail" | "error"; output?: string; message?: string };

export function Learn() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [lesson, setLesson] = useState<Lesson>(LESSONS[0]!);
  const [code, setCode] = useState(LESSONS[0]!.exercise.starter);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [done, setDone] = useState<Set<string>>(new Set());
  const { theme } = useTheme();

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    try {
      setDone(new Set(JSON.parse(localStorage.getItem("mcs-lessons-done") ?? "[]")));
    } catch {
      /* ignore */
    }
  }, []);

  const pick = (l: Lesson) => {
    setLesson(l);
    setCode(l.exercise.starter);
    setCheck({ state: "idle" });
  };

  /** Build the learner's code with GCC (Linux), run it in the sandbox with the exercise input, compare output. */
  const verify = async () => {
    setCheck({ state: "building" });
    try {
      const pid = await practiceProject(lesson);
      await api.saveFiles(pid, [{ path: "main.cpp", content: code, encoding: "utf8" }]);
      const { job } = await api.build(pid, { compiler: "gcc", target: "linux-elf", mode: "debug", kind: "single", output: "executable" });
      const final = await followJob(job.id, () => undefined);
      if (final.status !== "succeeded" || !final.result?.artifact) {
        const first = final.result?.diagnostics?.find((d) => d.severity === "error");
        setCheck({ state: "error", message: first ? `سطر ${first.line}: ${first.explanationAr ?? first.message}` : final.result?.summaryAr ?? "فشل البناء", output: first?.message });
        return;
      }
      setCheck({ state: "running" });
      const { job: runJob } = await api.startRun(pid, final.result.artifact.id, "native", false);
      const s = new RunSession(runJob.id, false, "native");
      let out = "";
      let sent = false;
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          s.stop();
          resolve();
        }, 20000);
        s.subscribe((m) => {
          if (m.type === "status" && m.status === "running" && !sent) {
            sent = true;
            if (lesson.exercise.stdin) s.send({ type: "stdin", data: lesson.exercise.stdin.replace(/\n/g, "\r") });
            // Close stdin so programs that read until EOF terminate.
            s.send({ type: "stdin", data: "\x04" });
          } else if (m.type === "stdout" || m.type === "stderr") out += m.data;
          else if (m.type === "status" && (m.status === "exited" || m.status === "stopped" || m.status === "error")) {
            clearTimeout(t);
            resolve();
          }
        });
      });
      s.close();
      // A tty echoes the input we typed; remove it before comparing.
      let clean = norm(out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\^D/g, ""));
      if (lesson.exercise.stdin) clean = norm(clean.replace(norm(lesson.exercise.stdin), ""));
      const pass = clean === norm(lesson.exercise.expected) || clean.endsWith(norm(lesson.exercise.expected)) && clean.split("\n").length === norm(lesson.exercise.expected).split("\n").length;
      setCheck({ state: pass ? "pass" : "fail", output: clean });
      if (pass) {
        const n = new Set(done).add(lesson.id);
        setDone(n);
        try {
          localStorage.setItem("mcs-lessons-done", JSON.stringify([...n]));
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setCheck({ state: "error", message: e instanceof ApiError ? e.messageAr : "تعذّر التحقق" });
    }
  };

  const openAsProject = async () => {
    const { project } = await api.createProject({ name: lesson.titleAr, files: [{ path: "main.cpp", content: lesson.example, encoding: "utf8" }] });
    location.href = `/ide/?project=${project.id}`;
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Brand />
          <div className="flex items-center gap-1">
            <a className="btn btn-ghost" href="/">
              المشاريع
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[260px_1fr]">
        <nav aria-label="الدروس">
          <h1 className="mb-3 text-lg font-bold">دروس C++ التفاعلية</h1>
          <ol className="space-y-1">
            {LESSONS.map((l) => (
              <li key={l.id}>
                <button onClick={() => pick(l)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm ${lesson.id === l.id ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2"}`} aria-current={lesson.id === l.id}>
                  {done.has(l.id) ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : <span className="size-[15px] shrink-0 rounded-full border border-line-strong" />}
                  <span className="flex-1">{l.titleAr}</span>
                  <span className="chip">{l.level}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs leading-5 text-ink-3">التحقق من الحل يبني كودك فعلياً بـ GCC ويشغّله في بيئة معزولة ثم يقارن المخرجات.</p>
        </nav>

        <article className="min-w-0">
          <h2 className="text-2xl font-bold">{lesson.titleAr}</h2>
          <div className="mt-3 space-y-3 leading-8 text-ink-2">
            {lesson.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5 text-xs text-ink-3">
              <span>مثال</span>
              {user && (
                <button className="btn px-2 py-0.5 text-xs" onClick={openAsProject}>
                  <FolderOpen size={12} /> افتح في المحرر
                </button>
              )}
            </div>
            <pre className="overflow-auto bg-bg p-3 text-[13px] leading-6" dir="ltr">
              {lesson.example}
            </pre>
          </div>

          <section className="mt-6 rounded-xl border border-accent/30 bg-surface p-4">
            <h3 className="font-semibold text-accent">تمرين</h3>
            <p className="mt-1 leading-7">{lesson.exercise.promptAr}</p>
            <div className="mt-3 h-64 overflow-hidden rounded-lg border border-line" dir="ltr">
              <Editor
                value={code}
                onChange={(v) => setCode(v ?? "")}
                language="cpp"
                theme={theme === "dark" ? "vs-dark" : "vs"}
                options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4 }}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {user ? (
                <button className="btn btn-primary" onClick={verify} disabled={check.state === "building" || check.state === "running"}>
                  {check.state === "building" || check.state === "running" ? <Spinner /> : <Play size={15} />} تحقق من الحل
                </button>
              ) : (
                <a className="btn btn-primary" href="/">
                  سجّل الدخول للتحقق من الحل <ChevronLeft size={15} className="rtl:-scale-x-100" />
                </a>
              )}
              <details className="text-sm text-ink-3">
                <summary className="cursor-pointer">تلميح</summary>
                <p className="mt-1 font-mono" dir="auto">
                  {lesson.exercise.hintAr}
                </p>
              </details>
            </div>
            {check.state !== "idle" && (
              <div className="mt-3 rounded-lg border border-line bg-bg p-3 text-sm" role="status">
                {check.state === "building" && <span className="text-ink-2">جارٍ البناء على الخادم…</span>}
                {check.state === "running" && <span className="text-ink-2">جارٍ التشغيل في البيئة المعزولة…</span>}
                {check.state === "pass" && (
                  <span className="flex items-center gap-2 text-ok">
                    <CheckCircle2 size={16} /> أحسنت! المخرجات صحيحة.
                  </span>
                )}
                {check.state === "fail" && (
                  <div>
                    <span className="flex items-center gap-2 text-warn">
                      <XCircle size={16} /> المخرجات لا تطابق المطلوب بعد.
                    </span>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-ink-3">مخرجات برنامجك</div>
                        <pre className="mt-1 rounded bg-surface p-2 text-xs" dir="ltr">
                          {check.output || "(لا شيء)"}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-ink-3">المطلوب</div>
                        <pre className="mt-1 rounded bg-surface p-2 text-xs" dir="ltr">
                          {lesson.exercise.expected}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
                {check.state === "error" && (
                  <div className="text-danger">
                    <div>{check.message}</div>
                    {check.output && (
                      <pre className="mt-1 text-xs" dir="ltr">
                        {check.output}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </article>
      </main>
    </div>
  );
}
