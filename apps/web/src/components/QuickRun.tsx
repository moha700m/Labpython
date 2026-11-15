"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Code2, Download, FileUp, Hammer, Loader2, Monitor, Play, RotateCcw, Share2, Sparkles, TerminalSquare, Wand2, XCircle } from "lucide-react";
import type { Diagnostic } from "@mcs/shared";
import { formatBytesAr, formatDurationAr } from "@mcs/localization";
import { ApiError, api, ensureUser, followJob, shareProject, type Capabilities, type JobDetail, type Project, type Template, type User } from "@/lib/api";
import { RunSession } from "@/lib/run";
import { Brand, ThemeToggle, Toasts, useToasts } from "./common";
import { PreviewPanel } from "./ide/PreviewPanel";
import { RunTerminal } from "./ide/RunTerminal";

type Stage = "idle" | "uploading" | "building" | "built" | "running" | "failed";
type Fix = { path: string; descriptionAr: string };

const ACCEPT = ".cpp,.cc,.cxx,.c,.h,.hpp,.hh,.rc,.zip,.txt,.cmake";
const isZip = (f: File) => /\.zip$/i.test(f.name);

/**
 * One-page flow, built for phones: drop a C++ file (or several, or a ZIP) — or tap a ready example —
 * → project → real Windows EXE → started in the Windows Runner with a live console or a live window.
 * No sign-up needed: a guest session is created on first use.
 */
export function QuickRun() {
  const [user, setUser] = useState<User | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [examples, setExamples] = useState<Template[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [log, setLog] = useState("");
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [session, setSession] = useState<RunSession | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [, force] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const toasts = useToasts();

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => undefined);
    api.capabilities().then(setCaps).catch(() => undefined);
    api.templates().then((t) => setExamples(t.filter((x) => x.example))).catch(() => undefined);
    // /run/?project=<id> builds and runs an existing project (used by shared links).
    const pid = new URLSearchParams(location.search).get("project");
    if (pid) void api.project(pid).then((r) => buildAndRun(r.project)).catch(() => setError("المشروع غير موجود"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFixes([]);
    setError("");
    setShareUrl("");
  };

  const startRun = async (p: Project, artifactId: string) => {
    const gui = p.config.windowsSubsystem === "windows";
    const latestCaps = caps ?? (await api.capabilities().catch(() => null));
    if (!latestCaps?.runBackends.wine) {
      setError("الملف جاهز للتنزيل، لكن ما فيه Windows Runner متصل الحين لتشغيله هنا.");
      return;
    }
    const { job: run } = await api.startRun(p.id, artifactId, "wine", gui);
    const s = new RunSession(run.id, gui, "wine");
    s.subscribe(() => force((x) => x + 1));
    setSession(s);
    setStage("running");
  };

  const buildAndRun = async (p: Project) => {
    setProject(p);
    setStage("building");
    setFixes([]);
    setError("");
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
      // Smart help: ask the server which of these errors it can fix automatically.
      const preview = await api.autofix(p.id, final.id, false).catch(() => null);
      setFixes(preview?.fixes ?? []);
      return;
    }
    setStage("built");
    const fresh = (await api.project(p.id)).project;
    setProject(fresh);
    await startRun(fresh, final.result.artifact.id);
  };

  const withUser = async () => {
    const u = user ?? (await ensureUser());
    setUser(u);
    return u;
  };

  const start = async (files: File[]) => {
    if (!files.length) return;
    reset();
    setStage("uploading");
    try {
      await withUser();
      let p: Project;
      const name = files.length === 1 ? files[0]!.name.replace(/\.[^.]+$/, "") : "مشروع مرفوع";
      if (files.length === 1 && isZip(files[0]!)) {
        p = (await api.importZip(files[0]!)).project;
      } else {
        const zips = files.filter(isZip);
        const texts = files.filter((f) => !isZip(f));
        p = (await api.createProject({ name, files: await Promise.all(texts.map(async (f) => ({ path: f.name, content: await f.text(), encoding: "utf8" as const }))) })).project;
        if (zips.length) await api.upload(p.id, zips.map((f) => ({ file: f, path: f.name })));
      }
      await buildAndRun(p);
    } catch (e) {
      setStage("failed");
      setError(e instanceof ApiError ? e.messageAr : "صار خطأ غير متوقع");
    }
  };

  const startExample = async (t: Template) => {
    reset();
    setStage("uploading");
    try {
      await withUser();
      const { project: p } = await api.createProject({ name: t.nameAr, template: t.id });
      await buildAndRun(p);
    } catch (e) {
      setStage("failed");
      setError(e instanceof ApiError ? e.messageAr : "صار خطأ غير متوقع");
    }
  };

  const applyFixes = async () => {
    if (!project || !job) return;
    try {
      await api.autofix(project.id, job.id, true);
      toasts.push("تم الإصلاح ✔ نعيد البناء…", "ok");
      await buildAndRun((await api.project(project.id)).project);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّر الإصلاح", "error");
    }
  };

  const rerun = async () => {
    const art = job?.result?.artifact;
    if (!project || !art) return;
    session?.close();
    try {
      await startRun(project, art.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.messageAr : "تعذّر التشغيل");
    }
  };

  const share = async () => {
    if (!project) return;
    try {
      setShareUrl(await shareProject(project.id, project.name));
      toasts.push("رابط المشاركة جاهز 🔗", "ok");
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّرت المشاركة", "error");
    }
  };

  const art = job?.result?.artifact;
  const gui = project?.config.windowsSubsystem === "windows";
  const steps: { id: string; label: string; done: boolean; active: boolean; failed?: boolean }[] = [
    { id: "up", label: "تجهيز المشروع", done: !!project, active: stage === "uploading" },
    { id: "build", label: "بناء EXE", done: !!art, active: stage === "building", failed: stage === "failed" && !!project && !art },
    { id: "run", label: gui ? "تشغيل ومعاينة النافذة" : "تشغيل في الطرفية", done: session?.status === "exited", active: stage === "running" && !!session?.active },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-1">
            <a className="btn btn-ghost" href="/">{user ? "مشاريعي" : "الرئيسية"}</a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold sm:text-3xl">ارفع ملفك، وخلّه يشتغل 🚀</h1>
        <p className="mt-2 leading-7 text-ink-2">
          ملف <bdi dir="ltr" className="font-mono">.cpp</bdi> أو عدة ملفات أو مشروع <bdi dir="ltr" className="font-mono">.zip</bdi> — نبنيه لك ملف Windows EXE حقيقي، ونشغّله قدامك وتتحكم فيه. بدون تسجيل.
        </p>

        {stage === "idle" ? (
          <>
            <div
              className={`mt-6 grid place-items-center rounded-2xl border-2 border-dashed p-8 text-center transition sm:p-14 ${dragging ? "border-accent bg-accent-soft" : "border-line-strong grid-paper"}`}
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
              <button className="btn btn-primary mt-4 px-6 py-3 text-base" onClick={() => input.current?.click()}>
                اختر ملفاتك
              </button>
              <p className="mt-2 hidden text-sm text-ink-3 sm:block">أو اسحبها وأفلتها هنا</p>
              <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => e.target.files && start(Array.from(e.target.files))} aria-label="اختر ملفات C++ أو ZIP" />
              <p className="mt-4 max-w-md text-xs leading-6 text-ink-3">
                برامج Console تشتغل في طرفية تكتب فيها، وبرامج الواجهات (WinMain) تطلع كنافذة حية تضغط فيها. كل تشغيل في بيئة معزولة تنحذف بعد ما تخلص.
              </p>
              {caps && !caps.runBackends.wine && <p className="mt-3 text-xs text-danger">تنبيه: ما فيه Windows Runner متصل الحين — بنبني الملف وتقدر تنزّله فقط.</p>}
            </div>

            {examples.length > 0 && (
              <section className="mt-8">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Sparkles size={18} className="text-teal" /> أو جرّب مثال جاهز بضغطة
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {examples.map((t) => (
                    <button key={t.id} onClick={() => startExample(t)} className="group rounded-xl border border-line bg-surface p-4 text-start transition hover:border-accent">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{t.nameAr}</span>
                        {t.config.windowsSubsystem === "windows" ? <Monitor size={16} className="text-teal" /> : <TerminalSquare size={16} className="text-ink-3" />}
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-ink-2">{t.descriptionAr}</p>
                      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                        <Play size={12} /> شغّل
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
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

              {fixes.length > 0 && (
                <div className="rounded-xl border border-accent/50 bg-accent-soft p-4 text-sm">
                  <div className="flex items-center gap-2 font-semibold">
                    <Wand2 size={16} className="text-accent" /> لقينا حل للمشكلة
                  </div>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-ink-2">
                    {fixes.map((f, i) => (
                      <li key={i}>{f.descriptionAr}</li>
                    ))}
                  </ul>
                  <button className="btn btn-primary mt-3 w-full justify-center" onClick={applyFixes}>
                    <Wand2 size={15} /> أصلحها وأعد البناء
                  </button>
                </div>
              )}

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
                    <Play size={15} className="text-ok" /> شغّل مرة ثانية
                  </button>
                )}
                {project && (
                  <button className="btn" onClick={share}>
                    <Share2 size={15} /> شارك برابط
                  </button>
                )}
                {project && (
                  <a className="btn" href={`/ide/?project=${project.id}`}>
                    <Code2 size={15} /> عدّل في المحرر
                  </a>
                )}
                <button className="btn btn-ghost" onClick={reset}>
                  <RotateCcw size={15} /> ملف ثاني
                </button>
              </div>
              {shareUrl && (
                <label className="block text-xs text-ink-3">
                  رابط المشاركة — أي أحد يفتحه يقدر يشغّل نسخته
                  <input className="field mt-1 font-mono text-xs" dir="ltr" readOnly value={shareUrl} onFocus={(e) => e.target.select()} aria-label="رابط المشاركة" />
                </label>
              )}
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
            </aside>

            <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-ink-3">
                {stage === "running" ? (gui ? <Monitor size={14} /> : <TerminalSquare size={14} />) : <Hammer size={14} />}
                {stage === "running" ? (gui ? "نافذة البرنامج — اضغط واكتب للتحكم" : "طرفية البرنامج") : "سجل البناء"}
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
                    {(log || "جاري التجهيز…").split("\n").map((l, i) => (
                      <div key={i} dir="auto" className="whitespace-pre-wrap break-words text-start" style={{ unicodeBidi: "plaintext" }}>{l || " "}</div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
    </div>
  );
}
