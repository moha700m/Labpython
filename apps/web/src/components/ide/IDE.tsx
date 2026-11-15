"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Bug, Code2, Download, FileArchive, Files, Hammer, LayoutPanelLeft, Monitor, Play, Settings2, Share2, Sparkles, Square, TerminalSquare, Wand2, XCircle,
} from "lucide-react";
import type { BuildConfig, Diagnostic, ProjectFile } from "@mcs/shared";
import { formatBytesAr, formatDurationAr } from "@mcs/localization";
import { ApiError, api, followJob, shareProject, type ArtifactRow, type Capabilities, type FileEntry, type JobDetail, type Project, type ProposedChange } from "@/lib/api";
import { RunSession } from "@/lib/run";
import { Brand, Spinner, ThemeToggle, Toasts, useTheme, useToasts } from "../common";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { FileTree } from "./FileTree";
import { BuildSettings } from "./BuildSettings";
import { AssistantPanel } from "./AssistantPanel";
import { RunTerminal } from "./RunTerminal";
import { PreviewPanel } from "./PreviewPanel";

type Buffer = { content: string; saved: string; encoding: "utf8" | "base64" };
type BottomTab = "problems" | "log" | "terminal" | "preview" | "artifacts";
type MobileView = "files" | "editor" | "output" | "assistant";

const PHASE_AR: Record<string, string> = {
  queued: "في الطابور", preparing: "تجهيز بيئة البناء", configuring: "تهيئة CMake", compiling: "الترجمة", linking: "الربط",
  packaging: "تجهيز الملف الناتج", done: "اكتمل", failed: "فشل", cancelled: "أُلغي", cancelling: "جارٍ الإلغاء",
};

function useIsMobile() {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

export function IDE({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [log, setLog] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [lastBuild, setLastBuild] = useState<{ artifactId: string; format: string; configKey: string; contentKey: string } | null>(null);
  const [session, setSession] = useState<RunSession | null>(null);
  const [, force] = useState(0);
  const [bottom, setBottom] = useState<BottomTab>("log");
  const [side, setSide] = useState<"files" | "assistant">("files");
  const [mobile, setMobile] = useState<MobileView>("editor");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [beginner, setBeginner] = useState(true);
  const [loadError, setLoadError] = useState("");
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const toasts = useToasts();
  const editorHandle = useRef<CodeEditorHandle>({ editor: null, monaco: null });
  const uploadFilesRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<HTMLInputElement>(null);
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;

  // ---------------------------------------------------------------- loading
  useEffect(() => {
    try {
      setBeginner(localStorage.getItem("mcs-mode") !== "pro");
    } catch {
      /* ignore */
    }
    (async () => {
      try {
        const [{ project, files }, capsRes] = await Promise.all([api.project(projectId), api.capabilities()]);
        setProject(project);
        setFiles(files);
        setCaps(capsRes);
        const first = files.find((f) => /(^|\/)main\.(cpp|cc|c)$/.test(f.path)) ?? files.find((f) => /\.(cpp|cc|c)$/.test(f.path)) ?? files[0];
        if (first) await openFile(first.path);
        const [{ artifacts }, { jobs }] = await Promise.all([api.artifacts(projectId), api.jobs(projectId)]);
        setArtifacts(artifacts);
        const lastB = jobs.find((j) => j.type === "build" && (j.status === "succeeded" || j.status === "failed"));
        if (lastB?.result) setDiagnostics(lastB.result.diagnostics ?? []);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.messageAr : "تعذّر فتح المشروع");
      }
    })();
    const t = setInterval(() => api.capabilities().then(setCaps).catch(() => undefined), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openFile = useCallback(
    async (path: string) => {
      if (!buffersRef.current[path]) {
        const { file } = await api.readFile(projectId, path);
        setBuffers((b) => ({ ...b, [path]: { content: file.content, saved: file.content, encoding: file.encoding } }));
      }
      setTabs((t) => (t.includes(path) ? t : [...t, path]));
      setActive(path);
      setMobile("editor");
    },
    [projectId],
  );

  const closeTab = (path: string) => {
    if (buffers[path] && buffers[path].content !== buffers[path].saved && !confirm("الملف غير محفوظ. إغلاقه على أي حال؟")) return;
    setTabs((t) => {
      const n = t.filter((x) => x !== path);
      if (active === path) setActive(n[n.length - 1] ?? null);
      return n;
    });
  };

  // ---------------------------------------------------------------- saving
  const dirty = useMemo(() => new Set(Object.entries(buffers).filter(([, b]) => b.content !== b.saved).map(([p]) => p)), [buffers]);

  const saveAll = useCallback(async () => {
    const pending = Object.entries(buffersRef.current).filter(([, b]) => b.content !== b.saved && b.encoding === "utf8");
    if (!pending.length) return true;
    try {
      const res = await api.saveFiles(projectId, pending.map(([path, b]) => ({ path, content: b.content, encoding: "utf8" as const })));
      setFiles(res.files);
      setBuffers((cur) => {
        const n = { ...cur };
        for (const [p, b] of pending) if (n[p]) n[p] = { ...n[p]!, saved: b.content };
        return n;
      });
      return true;
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل الحفظ", "error");
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Autosave shortly after typing stops.
  useEffect(() => {
    if (!dirty.size) return;
    const t = setTimeout(() => void saveAll(), 1200);
    return () => clearTimeout(t);
  }, [buffers, dirty.size, saveAll]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.size) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.size]);

  const onChange = (v: string) => {
    if (!active) return;
    setBuffers((b) => ({ ...b, [active]: { ...b[active]!, content: v } }));
  };

  // ---------------------------------------------------------------- build
  const config = project?.config;
  const configKey = config ? JSON.stringify(config) : "";
  const building = job?.status === "queued" || job?.status === "running";
  const compilerReady = !!(config && caps?.compilers.find((c) => c.id === config.compiler)?.available);

  const build = useCallback(
    async (override?: Partial<BuildConfig>): Promise<JobDetail | null> => {
      if (!project) return null;
      if (!(await saveAll())) return null;
      setBottom("log");
      setMobile("output");
      setLog("");
      try {
        const { job, workerAvailable } = await api.build(project.id, override);
        if (!workerAvailable) toasts.push("لا يوجد عامل بناء متصل لهذا المترجم حالياً — ستبقى المهمة في الطابور حتى يتصل عامل.", "error");
        setJob(job);
        const final = await followJob(job.id, (j, full) => {
          setJob(j);
          setLog(full);
        });
        const diags = final.result?.diagnostics ?? [];
        setDiagnostics(diags);
        if (final.status === "succeeded" && final.result?.artifact) {
          const files2 = (await api.project(project.id)).files;
          setFiles(files2);
          setLastBuild({ artifactId: final.result.artifact.id, format: final.result.artifact.format, configKey: JSON.stringify({ ...project.config, ...override }), contentKey: files2.map((f) => `${f.path}@${f.updated_at}`).join("|") });
          void api.artifacts(project.id).then((r) => setArtifacts(r.artifacts));
          toasts.push(final.result.summaryAr, "ok");
        } else {
          if (diags.some((d) => d.severity === "error")) setBottom("problems");
          toasts.push(final.result?.summaryAr ?? "فشل البناء", "error");
        }
        return final;
      } catch (e) {
        toasts.push(e instanceof ApiError ? e.messageAr : "فشل بدء البناء", "error");
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, saveAll],
  );

  const ensureArtifact = async () => {
    await saveAll();
    const freshFiles = (await api.project(projectId)).files;
    const freshKey = freshFiles.map((f) => `${f.path}@${f.updated_at}`).join("|");
    if (lastBuild && lastBuild.configKey === configKey && lastBuild.contentKey === freshKey) return { id: lastBuild.artifactId, format: lastBuild.format };
    const final = await build();
    if (final?.status !== "succeeded" || !final.result?.artifact) return null;
    return { id: final.result.artifact.id, format: final.result.artifact.format };
  };

  // ---------------------------------------------------------------- run
  const run = async () => {
    if (!project || !config) return;
    if (config.output !== "executable") {
      toasts.push("هذا المشروع ينتج مكتبة، لا برنامجاً قابلاً للتشغيل.", "error");
      return;
    }
    const art = await ensureArtifact();
    if (!art) return;
    const isPe = art.format.startsWith("pe");
    const backend = isPe ? "wine" : "native";
    const display = isPe && config.windowsSubsystem === "windows";
    if (isPe && !caps?.runBackends.wine) {
      toasts.push("لا يوجد Windows Runner متصل لتشغيل ملفات EXE. يمكنك تنزيل الملف وتشغيله على جهاز Windows.", "error");
      return;
    }
    if (!isPe && !caps?.runBackends.native) {
      toasts.push("لا يوجد عامل تشغيل Linux متصل.", "error");
      return;
    }
    if (!confirm(isPe ? "سيتم تشغيل ملف EXE في Windows Runner معزول. متابعة؟" : "سيتم تشغيل البرنامج في بيئة Linux معزولة. متابعة؟")) return;
    session?.close();
    try {
      const { job: runJob } = await api.startRun(project.id, art.id, backend, display);
      const s = new RunSession(runJob.id, display, backend);
      s.subscribe(() => force((x) => x + 1));
      setSession(s);
      setBottom(display ? "preview" : "terminal");
      setMobile("output");
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل بدء التشغيل", "error");
    }
  };

  const stopRun = () => session?.stop();
  const exportExe = async () => {
    const art = await ensureArtifact();
    if (art) location.href = `/api/artifacts/${art.id}/download`;
  };

  // ---------------------------------------------------------------- files
  const createFile = async (p: string) => {
    try {
      const content = /\.(h|hpp|hh)$/i.test(p) ? "#pragma once\n\n" : /\.(cpp|cc|c)$/i.test(p) ? "\n" : "";
      const r = await api.saveFiles(projectId, [{ path: p, content, encoding: "utf8" }]);
      setFiles(r.files);
      const created = r.files.find((f) => f.path === p.replace(/^\.?\//, "")) ?? r.files[r.files.length - 1];
      if (created) await openFile(created.path);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّر إنشاء الملف", "error");
    }
  };
  const deleteFile = async (p: string) => {
    const r = await api.deleteFile(projectId, p);
    setFiles(r.files);
    setTabs((t) => t.filter((x) => x !== p));
    setBuffers((b) => {
      const n = { ...b };
      delete n[p];
      return n;
    });
    if (active === p) setActive(null);
  };
  const renameFile = async (from: string, to: string) => {
    try {
      await saveAll();
      const r = await api.renameFile(projectId, from, to);
      setFiles(r.files);
      setBuffers((b) => {
        const n = { ...b };
        delete n[from];
        return n;
      });
      setTabs((t) => t.filter((x) => x !== from));
      const target = r.files.find((f) => !files.some((o) => o.path === f.path));
      if (target) await openFile(target.path);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّرت إعادة التسمية", "error");
    }
  };
  const uploadList = async (list: FileList | null, folder: boolean) => {
    if (!list?.length) return;
    const items = Array.from(list).map((file) => {
      const rp = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return { file, path: folder && rp ? rp.slice(rp.indexOf("/") + 1) : file.name };
    });
    try {
      const r = await api.upload(projectId, items);
      setFiles(r.files);
      toasts.push(`أُضيف ${r.added.length} ملف${r.skipped.length ? `، وتم تجاهل ${r.skipped.length}` : ""}${r.rejected.length ? `، ورُفض ${r.rejected.length} لأسباب أمنية` : ""}`, r.rejected.length ? "error" : "ok");
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل الرفع", "error");
    }
  };

  const format = async () => {
    if (!active || !buffers[active]) return;
    try {
      const { content } = await api.format(buffers[active]!.content, active);
      setBuffers((b) => ({ ...b, [active]: { ...b[active]!, content } }));
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّر التنسيق", "error");
    }
  };

  const applyChanges = async (changes: ProposedChange[]) => {
    const writes: ProjectFile[] = changes.filter((c) => c.action !== "delete").map((c) => ({ path: c.path, content: c.content, encoding: "utf8" }));
    try {
      if (writes.length) {
        const r = await api.saveFiles(projectId, writes);
        setFiles(r.files);
      }
      for (const c of changes.filter((x) => x.action === "delete")) await deleteFile(c.path);
      setBuffers((b) => {
        const n = { ...b };
        for (const w of writes) n[w.path] = { content: w.content, saved: w.content, encoding: "utf8" };
        return n;
      });
      toasts.push(`طُبّقت ${changes.length} تعديلات بموافقتك`, "ok");
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل تطبيق التعديلات", "error");
    }
  };

  /** Smart fixes for the last failed build (computed server-side from its diagnostics). */
  const smartFix = async () => {
    if (!job || job.type !== "build") return;
    try {
      await saveAll();
      const preview = await api.autofix(projectId, job.id, false);
      if (!preview.fixes.length) {
        toasts.push("ما لقينا إصلاح تلقائي لهذي الأخطاء — جرّب المساعد الذكي أو اقرأ الشرح تحت كل خطأ.", "info");
        return;
      }
      if (!confirm("بنسوي التعديلات التالية:\n\n" + preview.fixes.map((f) => "• " + f.descriptionAr).join("\n") + "\n\nموافق؟")) return;
      const applied = await api.autofix(projectId, job.id, true);
      const fresh = await api.project(projectId);
      setProject(fresh.project);
      setFiles(fresh.files);
      for (const p of applied.changedFiles) {
        const { file } = await api.readFile(projectId, p);
        setBuffers((b) => ({ ...b, [p]: { content: file.content, saved: file.content, encoding: file.encoding } }));
      }
      toasts.push("تم الإصلاح ✔ نعيد البناء…", "ok");
      setTimeout(() => void build(), 50);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّر الإصلاح", "error");
    }
  };

  const share = async () => {
    try {
      await saveAll();
      await shareProject(projectId, project?.name ?? "");
      toasts.push("تم نسخ رابط المشاركة 🔗", "ok");
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "تعذّرت المشاركة", "error");
    }
  };

  const saveConfig = async (c: BuildConfig) => {
    try {
      const { project: p } = await api.updateProject(projectId, { config: c });
      setProject(p);
      setSettingsOpen(false);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "إعدادات غير صالحة", "error");
    }
  };

  const toggleMode = () => {
    const next = !beginner;
    setBeginner(next);
    try {
      localStorage.setItem("mcs-mode", next ? "beginner" : "pro");
    } catch {
      /* ignore */
    }
  };

  const diagCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of diagnostics) if (d.severity === "error") m[d.file] = (m[d.file] ?? 0) + 1;
    return m;
  }, [diagnostics]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  const jumpTo = async (d: Diagnostic) => {
    if (!files.some((f) => f.path === d.file)) return;
    await openFile(d.file);
    setTimeout(() => {
      const ed = editorHandle.current.editor;
      if (ed && d.line > 0) {
        ed.revealLineInCenter(d.line);
        ed.setPosition({ lineNumber: d.line, column: d.column || 1 });
        ed.focus();
      }
    }, 80);
  };

  if (loadError)
    return (
      <div className="app-h grid place-items-center p-6 text-center">
        <div>
          <p className="text-danger">{loadError}</p>
          <a className="btn mt-4" href="/">
            العودة للمشاريع
          </a>
        </div>
      </div>
    );
  if (!project || !config)
    return (
      <div className="app-h grid place-items-center text-ink-3">
        <Spinner size={20} />
      </div>
    );

  const runActive = !!session?.active;
  const isWin = config.target === "windows-exe";
  const activeBuf = active ? buffers[active] : undefined;

  // ---------------------------------------------------------------- panels
  const toolbar = (
    <div className="flex items-center gap-1.5">
      <button className="btn btn-primary" onClick={() => build()} disabled={building} title="بناء (Ctrl+B)" aria-label="بناء">
        {building ? <Spinner /> : <Hammer size={15} />} <span className="hidden sm:inline">بناء</span>
      </button>
      {runActive ? (
        <button className="btn border-danger/50 text-danger" onClick={stopRun} title="إيقاف" aria-label="إيقاف">
          <Square size={15} /> <span className="hidden sm:inline">إيقاف</span>
        </button>
      ) : (
        <button className="btn" onClick={run} disabled={building} title="تشغيل (F5)" aria-label="تشغيل">
          <Play size={15} className="text-ok" /> <span className="hidden sm:inline">تشغيل</span>
        </button>
      )}
      <button className="btn hidden md:inline-flex" disabled title="التصحيح (Breakpoints / Call Stack) غير متاح بعد — مخطط في المرحلة 6">
        <Bug size={15} /> تصحيح
      </button>
      <button className="btn" onClick={exportExe} disabled={building} title={isWin ? "تنزيل ملف EXE" : "تنزيل الملف الناتج"} aria-label={isWin ? "تصدير EXE" : "تنزيل"}>
        <Download size={15} /> <span className="hidden lg:inline">{isWin ? "تصدير EXE" : "تنزيل"}</span>
      </button>
    </div>
  );

  const bottomTabs: { id: BottomTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "problems", label: "المشكلات", icon: <AlertTriangle size={13} />, badge: errors + warnings },
    { id: "log", label: "سجل البناء", icon: <Hammer size={13} /> },
    { id: "terminal", label: "الطرفية", icon: <TerminalSquare size={13} /> },
    { id: "preview", label: "المعاينة", icon: <Monitor size={13} /> },
    { id: "artifacts", label: "الملفات الناتجة", icon: <FileArchive size={13} /> },
  ];

  const statusLine = job && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-xs">
      <span className={job.status === "succeeded" ? "text-ok" : job.status === "failed" ? "text-danger" : "text-accent"}>● {PHASE_AR[job.phase] ?? job.phase}</span>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-all rtl:ms-auto" style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
      <span className="text-ink-3">{Math.round(job.progress * 100)}%</span>
      {job.result && <span className="text-ink-2">{formatDurationAr(job.result.durationMs)}</span>}
      {job.result?.artifact && (
        <>
          <span className="text-ink-2">{formatBytesAr(job.result.artifact.size)}</span>
          <bdi dir="ltr" className="font-mono text-ink-2">
            {job.result.artifact.fileName}
          </bdi>
          <span className="text-teal">{job.result.artifact.description}</span>
        </>
      )}
      {building && (
        <button className="btn ms-auto px-2 py-0.5 text-xs" onClick={() => api.cancelJob(job.id)}>
          إلغاء
        </button>
      )}
    </div>
  );

  const problems = (
    <div className="h-full overflow-auto scroll-thin">
      {errors > 0 && job?.status === "failed" && (
        <div className="flex items-center gap-2 border-b border-line bg-accent-soft px-3 py-2">
          <Wand2 size={15} className="text-accent" />
          <span className="text-[13px] text-ink-2">نقدر نصلح الأخطاء الشائعة تلقائياً</span>
          <button className="btn btn-primary ms-auto px-2.5 py-1 text-xs" onClick={smartFix}>
            إصلاح تلقائي
          </button>
        </div>
      )}
      {diagnostics.length === 0 ? (
        <p className="p-4 text-sm text-ink-3">لا توجد مشكلات. {job?.status === "succeeded" ? "البناء الأخير نجح." : ""}</p>
      ) : (
        <ul className="divide-y divide-line">
          {diagnostics.map((d, i) => (
            <li key={i}>
              <button className="block w-full px-3 py-2 text-start hover:bg-surface-2" onClick={() => jumpTo(d)}>
                <div className="flex items-start gap-2 text-[13px]">
                  {d.severity === "error" ? <XCircle size={14} className="mt-0.5 shrink-0 text-danger" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />}
                  <div className="min-w-0">
                    <div className="font-mono text-ink" dir="ltr" style={{ textAlign: "start" }}>
                      <bdi>{d.message}</bdi>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-ink-3" dir="ltr" style={{ textAlign: "start" }}>
                      {d.file}
                      {d.line > 0 && `:${d.line}:${d.column}`}
                    </div>
                    {d.explanationAr && <div className="mt-1 text-[13px] leading-6 text-ink-2">{d.explanationAr}</div>}
                    {d.suggestionAr && <div className="text-[13px] leading-6 text-teal">💡 {d.suggestionAr}</div>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const logView = (
    <div className="flex h-full flex-col">
      {statusLine}
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12.5px] leading-5 text-ink-2 scroll-thin" role="log" aria-label="سجل البناء">
        {log
          ? log.split("\n").map((l, i) => (
              <div key={i} dir="auto" className={`whitespace-pre-wrap break-words text-start ${l.startsWith("$ ") ? "text-ink-3" : /(^|: )(fatal )?error/.test(l) || l.startsWith("✖") ? "text-danger" : /warning:/.test(l) ? "text-warn" : l.startsWith("✔") ? "text-ok" : ""}`} style={{ unicodeBidi: "plaintext" }}>
                {l || "\u00a0"}
              </div>
            ))
          : <p className="font-sans">{job ? "" : "اضغط «بناء» (Ctrl+B) لترجمة المشروع. سيظهر هنا السجل الكامل لعملية البناء."}</p>}
      </div>
    </div>
  );

  const artifactsView = (
    <div className="h-full overflow-auto scroll-thin">
      {artifacts.length === 0 ? (
        <p className="p-4 text-sm text-ink-3">لا توجد ملفات ناتجة بعد.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead className="text-xs text-ink-3">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 text-start font-normal">الملف</th>
              <th className="px-3 py-1.5 text-start font-normal">الصيغة</th>
              <th className="px-3 py-1.5 text-start font-normal">الحجم</th>
              <th className="hidden px-3 py-1.5 text-start font-normal md:table-cell">SHA-256</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {artifacts.map((a) => (
              <tr key={a.id} className="border-b border-line">
                <td className="px-3 py-1.5 font-mono" dir="ltr" style={{ textAlign: "start" }}>
                  {a.file_name}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`chip font-mono ${a.format.startsWith("pe") ? "text-teal" : ""}`} dir="ltr">
                    {a.format}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-ink-2">{formatBytesAr(a.size)}</td>
                <td className="hidden px-3 py-1.5 font-mono text-[11px] text-ink-3 md:table-cell" dir="ltr">
                  {a.sha256.slice(0, 16)}…
                </td>
                <td className="px-3 py-1.5 text-end">
                  <a className="btn px-2 py-0.5 text-xs" href={`/api/artifacts/${a.id}/download`}>
                    <Download size={12} /> تنزيل
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const bottomContent = (tab: BottomTab) =>
    tab === "problems" ? problems : tab === "log" ? logView : tab === "terminal" ? <RunTerminal session={session && !session.display ? session : null} theme={theme} /> : tab === "preview" ? <PreviewPanel session={session} /> : artifactsView;

  const tabsBar = (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface scroll-thin" role="tablist">
      {tabs.map((t) => (
        <div key={t} className={`group flex items-center gap-1.5 border-e border-line px-3 text-[13px] ${t === active ? "bg-bg text-ink" : "text-ink-3"}`} role="tab" aria-selected={t === active}>
          <button className="font-mono" dir="ltr" onClick={() => setActive(t)}>
            {t.split("/").pop()}
          </button>
          {dirty.has(t) ? <span className="size-1.5 rounded-full bg-accent" /> : null}
          <button className="opacity-40 hover:opacity-100" onClick={() => closeTab(t)} aria-label={`إغلاق ${t}`}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  const editorArea =
    active && activeBuf ? (
      activeBuf.encoding === "base64" ? (
        <div className="grid h-full place-items-center text-sm text-ink-3">ملف ثنائي — لا يمكن تحريره هنا.</div>
      ) : (
        <CodeEditor
          path={active}
          value={activeBuf.content}
          onChange={onChange}
          diagnostics={diagnostics}
          theme={theme}
          beginner={beginner}
          onSave={() => void saveAll()}
          onBuild={() => void build()}
          onRun={() => void run()}
          onFormat={() => void format()}
          handleRef={editorHandle}
        />
      )
    ) : (
      <div className="grid-paper grid h-full place-items-center text-sm text-ink-3">اختر ملفاً من المستكشف</div>
    );

  const assistant = (
    <AssistantPanel
      projectId={projectId}
      available={!!caps?.ai.available}
      activeFile={active}
      getSelection={() => {
        const ed = editorHandle.current.editor;
        const sel = ed?.getSelection();
        return sel && ed?.getModel() ? ed.getModel()!.getValueInRange(sel) : "";
      }}
      getFileContent={async (p) => buffers[p]?.content ?? (files.some((f) => f.path === p) ? (await api.readFile(projectId, p)).file.content : null)}
      diagnostics={diagnostics}
      buildLog={log}
      theme={theme}
      onApply={applyChanges}
    />
  );

  const fileTree = (
    <FileTree
      files={files}
      active={active}
      dirty={dirty}
      diagCount={diagCount}
      onOpen={(p) => void openFile(p)}
      onCreate={createFile}
      onDelete={deleteFile}
      onRename={renameFile}
      onUploadFiles={() => uploadFilesRef.current?.click()}
      onUploadFolder={() => uploadFolderRef.current?.click()}
    />
  );

  return (
    <div className="app-h flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
        <Brand compact />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            <bdi>{project.name}</bdi>
          </div>
          <button className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-accent" onClick={() => setSettingsOpen(true)} title="إعدادات البناء">
            <span className="font-mono" dir="ltr">
              {config.compiler} · {config.standard} · {config.mode}
            </span>
            {!compilerReady && <span className="text-danger">(غير متصل)</span>}
          </button>
        </div>
        <div className="ms-auto flex items-center gap-1">
          {toolbar}
          <button className="btn btn-ghost px-2" onClick={share} title="شارك برابط" aria-label="شارك برابط">
            <Share2 size={15} />
          </button>
          <button className="btn btn-ghost hidden px-2 sm:inline-flex" onClick={() => void format()} title="تنسيق الكود (Shift+Alt+F)" aria-label="تنسيق الكود">
            <Wand2 size={15} />
          </button>
          <button className="btn btn-ghost px-2" onClick={() => setSettingsOpen(true)} title="إعدادات البناء" aria-label="إعدادات البناء">
            <Settings2 size={15} />
          </button>
          <button className="btn btn-ghost hidden px-2 text-xs md:inline-flex" onClick={toggleMode} title="تبديل وضع المبتدئ/المحترف">
            {beginner ? "مبتدئ" : "محترف"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Desktop layout (only one layout is mounted so editors never share/dispose models twice) */}
      {!isMobile && (
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-e border-line bg-surface py-2" aria-label="الأدوات">
          <button className={`btn btn-ghost px-2 ${side === "files" ? "text-accent" : ""}`} onClick={() => setSide("files")} title="المستكشف" aria-label="المستكشف">
            <Files size={18} />
          </button>
          <button className={`btn btn-ghost px-2 ${side === "assistant" ? "text-accent" : ""}`} onClick={() => setSide("assistant")} title="المساعد الذكي" aria-label="المساعد الذكي">
            <Sparkles size={18} />
          </button>
          <a className="btn btn-ghost px-2" href="/learn/" title="التعلّم" aria-label="التعلّم">
            <LayoutPanelLeft size={18} />
          </a>
        </nav>
        <aside className="w-64 shrink-0 border-e border-line bg-surface lg:w-72 xl:w-80">{side === "files" ? fileTree : assistant}</aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {tabsBar}
          <div className="min-h-0 flex-[3]">{editorArea}</div>
          <section className="flex min-h-0 flex-[2] flex-col border-t border-line bg-surface">
            <div className="flex h-8 shrink-0 items-stretch gap-0.5 border-b border-line px-1 text-xs" role="tablist">
              {bottomTabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={bottom === t.id} onClick={() => setBottom(t.id)} className={`flex items-center gap-1.5 border-b-2 px-2.5 ${bottom === t.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}>
                  {t.icon} {t.label}
                  {!!t.badge && <span className={`rounded px-1 text-[10px] ${errors ? "bg-danger/20 text-danger" : "bg-warn/20 text-warn"}`}>{t.badge}</span>}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">{bottomContent(bottom)}</div>
          </section>
        </main>
      </div>

      )}

      {/* Mobile layout: one view at a time + bottom navigation */}
      {isMobile && (
      <div className="flex min-h-0 flex-1 flex-col">
        {mobile === "files" && <div className="min-h-0 flex-1 bg-surface">{fileTree}</div>}
        {mobile === "editor" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {tabsBar}
            <div className="min-h-0 flex-1">{editorArea}</div>
          </div>
        )}
        {mobile === "output" && (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-1.5 text-xs">
              {bottomTabs.map((t) => (
                <button key={t.id} onClick={() => setBottom(t.id)} className={`chip whitespace-nowrap ${bottom === t.id ? "border-accent text-accent" : ""}`}>
                  {t.label} {!!t.badge && `(${t.badge})`}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">{bottomContent(bottom)}</div>
          </div>
        )}
        {mobile === "assistant" && <div className="min-h-0 flex-1 bg-surface">{assistant}</div>}
        <nav className="safe-b grid shrink-0 grid-cols-4 border-t border-line bg-surface" aria-label="التنقل">
          {(
            [
              ["files", "الملفات", <Files key="f" size={18} />],
              ["editor", "المحرر", <Code2 key="e" size={18} />],
              ["output", "المخرجات", <TerminalSquare key="o" size={18} />],
              ["assistant", "المساعد", <Sparkles key="a" size={18} />],
            ] as [MobileView, string, React.ReactNode][]
          ).map(([id, label, icon]) => (
            <button key={id} onClick={() => setMobile(id)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${mobile === id ? "text-accent" : "text-ink-3"}`} aria-current={mobile === id}>
              {icon}
              {label}
              {id === "output" && errors > 0 && <span className="absolute mt-0 size-1.5 rounded-full bg-danger" />}
            </button>
          ))}
        </nav>
      </div>
      )}

      <input ref={uploadFilesRef} type="file" multiple hidden accept=".cpp,.cc,.cxx,.c,.h,.hpp,.hh,.hxx,.inl,.txt,.cmake,.md,.json,.rc,.ico,.png,.bmp,.zip,.mk" onChange={(e) => uploadList(e.target.files, false)} />
      <input ref={uploadFolderRef} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => uploadList(e.target.files, true)} />
      <BuildSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} config={config} caps={caps} beginner={beginner} onSave={saveConfig} />
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
    </div>
  );
}
