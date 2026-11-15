"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Code2, Download, FileUp, Hammer, Loader2, Monitor, Play, RotateCcw, TerminalSquare, XCircle } from "lucide-react";
import type { Diagnostic } from "@mcs/shared";
import { formatBytesAr, formatDurationAr } from "@mcs/localization";
import { ApiError, api, followJob, type Capabilities, type JobDetail, type Project, type User } from "@/lib/api";
import { RunSession } from "@/lib/run";
import { AuthScreen } from "./AuthScreen";
import { Brand, ThemeToggle } from "./common";
import { PreviewPanel } from "./ide/PreviewPanel";
import { RunTerminal } from "./ide/RunTerminal";

type Stage = "idle" | "uploading" | "building" | "built" | "running" | "failed";

const ACCEPT = ".cpp,.cc,.cxx,.c,.h,.hpp,.hh,.rc,.zip,.txt,.cmake";
const isZip = (f: File) => /\.zip$/i.test(f.name);

/**
 * One-page flow: drop a C++ file (or several, or a ZIP) → project is created → built into a real
 * Windows EXE → started in the Windows Runner with live console or live window preview.
 */
export function QuickRun() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [log, setLog] = useState("");
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [session, setSession] = useState<RunSession | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [, force] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    api.capabilities().then(setCaps).catch(() => undefined);
  }, []);

  const reset = () => {
    session?.stop();
    session?.close();
    setSession(null);
    setStage("idle");
    setProject(null);
    setJob(null);
    setLog("");
    setDiags([]);
    setError("");
  };

  const start = async (files: File[]) => {
    if (!files.length) return;
    reset();
    setStage("uploading");
    try {
      // 1) Create the project.
      let p: Project;
      const name = files.length === 1 ? files[0]!.name.replace(/\.[^.]+$/, "") : "مشروع مرفوع";
      if (files.length === 1 && isZip(files[0]!)) {
        const r = await api.importZip(files[0]!);
        p = r.project;
      } else {
        const zips = files.filter(isZip);
        const texts = files.filter((f) => !isZip(f));
        const created = await api.createProject({
          name,
          files: await Promise.all(texts.map(async (f) => ({ path: f.name, content: await f.text(), encoding: "utf8" as const }))),
        });
        p = created.project;
        if (zips.length) await api.upload(p.id, zips.map((f) => ({ file: f, path: f.name })));
      }
      setProject(p);

      // 2) Build a Windows EXE.
      setStage("building");
      const { job: j } = await api.build(p.id, { compiler: "mingw-gcc", target: "windows-exe" });
      setJob(j);
      const final = await followJob(j.id, (jj, full) => {
        setJob(jj);
        setLog(full);
      });
      setDiags(final.result?.diagnostics ?? []);
      if (final.status !== "succeeded" || !final.result?.artifact) {
        setStage("failed");
        setError(final.result?.summaryAr ?? "فشل البناء");
        return;
      }
      setStage("built");

      // 3) Run it — GUI programs get a live window, console programs a live console.
      const fresh = (await api.project(p.id)).project;
      setProject(fresh);
      const gui = fresh.config.windowsSubsystem === "windows";
      if (!caps?.runBackends.wine) {
        setError("الملف جاهز للتنزيل، لكن لا يوجد Windows Runner متصل الآن لتشغيله هنا.");
        return;
      }
      const { job: run } = await api.startRun(p.id, final.result.artifact.id, "wine", gui);
      const s = new RunSession(run.id, gui, "wine");
      s.subscribe(() => force((x) => x + 1));
      setSession(s);
      setStage("running");
    } catch (e) {
      setStage("failed");
      setError(e instanceof ApiError ? e.messageAr : "حدث خطأ غير متوقع");
    }
  };

  const rerun = async () => {
    const art = job?.result?.artifact;
    if (!project || !art) return;
    session?.close();
    const gui = project.config.windowsSubsystem === "windows";
    try {
      const { job: run } = await api.startRun(project.id, art.id, "wine", gui);
      const s = new RunSession(run.id, gui, "wine");
      s.subscribe(() => force((x) => x + 1));
      setSession(s);
      setStage("running");
    } catch (e) {
      setError(e instanceof ApiError ? e.messageAr : "تعذّر التشغيل");
    }
  };

  if (user === undefined) return <div className="app-h grid place-items-center text-ink-3"><Loader2 className="animate-spin" /></div>;
  if (!user) return <AuthScreen onAuthed={setUser} />;

  const art = job?.result?.artifact;
  const gui = project?.config.windowsSubsystem === "windows";
  const steps: { id: string; label: string; done: boolean; active: boolean; failed?: boolean }[] = [
    { id: "up", label: "رفع الملف", done: !!project, active: stage === "uploading" },
    { id: "build", label: "بناء EXE", done: !!art, active: stage === "building", failed: stage === "failed" && !!project && !art },
    { id: "run", label: gui ? "تشغيل ومعاينة النافذة" : "تشغيل في الطرفية", done: session?.status === "exited", active: stage === "running" && !!session?.active },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-1">
            <a className="btn btn-ghost" href="/">المشاريع</a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold sm:text-3xl">ارفع ملفك، وشغّل تطبيقك</h1>
        <p className="mt-2 text-ink-2">
          اسحب ملف <bdi dir="ltr" className="font-mono">.cpp</bdi> أو عدة ملفات أو مشروعاً مضغوطاً <bdi dir="ltr" className="font-mono">.zip</bdi> — نبنيه إلى ملف Windows EXE حقيقي، ثم نشغّله أمامك وتتحكم فيه مباشرة.
        </p>

        {stage === "idle" ? (
          <div
            className={`mt-6 grid place-items-center rounded-2xl border-2 border-dashed p-10 text-center transition sm:p-16 ${dragging ? "border-accent bg-accent-soft" : "border-line-strong grid-paper"}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void start(Array.from(e.dataTransfer.files));
            }}
          >
            <FileUp size={40} className="text-accent" />
            <p className="mt-4 text-lg font-semibold">اسحب الملفات هنا</p>
            <p className="mt-1 text-sm text-ink-3">أو</p>
            <button className="btn btn-primary mt-3 px-5 py-2.5" onClick={() => input.current?.click()}>
              اختر ملفات من جهازك
            </button>
            <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => e.target.files && start(Array.from(e.target.files))} aria-label="اختر ملفات C++ أو ZIP" />
            <p className="mt-5 max-w-md text-xs leading-6 text-ink-3">
              برامج Console تظهر في طرفية تفاعلية، وبرامج الواجهة الرسومية (WinMain) تظهر كنافذة حية تتحكم فيها بالماوس ولوحة المفاتيح. التشغيل يتم في بيئة معزولة وتُحذف بعد انتهاء الجلسة.
            </p>
            {caps && !caps.runBackends.wine && <p className="mt-3 text-xs text-danger">تنبيه: لا يوجد Windows Runner متصل حالياً — سيُبنى الملف ويمكنك تنزيله فقط.</p>}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]">
            <aside className="space-y-4">
              <ol className="rounded-xl border border-line bg-surface p-4">
                {steps.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-1.5 text-sm">
                    {s.failed ? <XCircle size={18} className="text-danger" /> : s.done ? <CheckCircle2 size={18} className="text-ok" /> : s.active ? <Loader2 size={18} className="animate-spin text-accent" /> : <Circle size={18} className="text-ink-3" />}
                    <span className={s.active ? "text-ink" : "text-ink-2"}>{s.label}</span>
                  </li>
                ))}
              </ol>

              {job && (
                <div className="rounded-xl border border-line bg-surface p-4 text-sm">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(job.progress * 100)}>
                    <div className="h-full bg-accent transition-all rtl:ms-auto" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                  {art && (
                    <dl className="mt-3 space-y-1 text-ink-2">
                      <div className="flex justify-between gap-2"><dt>الملف</dt><dd className="font-mono" dir="ltr">{art.fileName}</dd></div>
                      <div className="flex justify-between gap-2"><dt>الحجم</dt><dd>{formatBytesAr(art.size)}</dd></div>
                      <div className="flex justify-between gap-2"><dt>وقت البناء</dt><dd>{formatDurationAr(job.result!.durationMs)}</dd></div>
                      <div className="text-xs text-teal">{art.description}</div>
                    </dl>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {art && (
                  <a className="btn btn-primary" href={`/api/artifacts/${art.id}/download`}>
                    <Download size={15} /> تنزيل EXE
                  </a>
                )}
                {art && !session?.active && caps?.runBackends.wine && (
                  <button className="btn" onClick={rerun}>
                    <Play size={15} className="text-ok" /> تشغيل مرة أخرى
                  </button>
                )}
                {project && (
                  <a className="btn" href={`/ide/?project=${project.id}`}>
                    <Code2 size={15} /> افتح في المحرر
                  </a>
                )}
                <button className="btn btn-ghost" onClick={reset}>
                  <RotateCcw size={15} /> ملف آخر
                </button>
              </div>
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
            </aside>

            <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-ink-3">
                {stage === "running" ? (gui ? <Monitor size={14} /> : <TerminalSquare size={14} />) : <Hammer size={14} />}
                {stage === "running" ? (gui ? "نافذة البرنامج — انقر واكتب للتحكم" : "طرفية البرنامج") : "سجل البناء"}
              </div>
              <div className="min-h-0 flex-1">
                {stage === "running" && session ? (
                  gui ? <PreviewPanel session={session} /> : <RunTerminal session={session} />
                ) : (
                  <div className="h-full overflow-auto p-3 font-mono text-[12.5px] leading-5 text-ink-2 scroll-thin" role="log" aria-label="سجل البناء">
                    {diags.filter((d) => d.severity === "error").map((d, i) => (
                      <div key={"d" + i} className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-2 font-sans">
                        <div className="font-mono text-xs text-danger" dir="ltr" style={{ textAlign: "start" }}>{d.file}{d.line > 0 && `:${d.line}`} — {d.message}</div>
                        {d.explanationAr && <div className="mt-1 text-sm">{d.explanationAr}</div>}
                        {d.suggestionAr && <div className="text-sm text-teal">💡 {d.suggestionAr}</div>}
                      </div>
                    ))}
                    {(log || "جارٍ التجهيز…").split("\n").map((l, i) => (
                      <div key={i} dir="auto" className="whitespace-pre-wrap break-words text-start" style={{ unicodeBidi: "plaintext" }}>{l || " "}</div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
