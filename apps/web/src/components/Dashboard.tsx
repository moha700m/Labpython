"use client";
import { useEffect, useRef, useState } from "react";
import { FileArchive, FolderUp, GraduationCap, LogOut, Plus, Trash2, Zap } from "lucide-react";
import { ApiError, api, type Capabilities, type Project, type Template, type User } from "@/lib/api";
import { Brand, Modal, Spinner, ThemeToggle, Toasts, useToasts } from "./common";

const LEVEL: Record<Template["level"], string> = { beginner: "مبتدئ", intermediate: "متوسط", pro: "محترف" };

function rel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
}

export function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toasts = useToasts();
  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const load = () => api.projects().then((r) => setProjects(r.projects));
  useEffect(() => {
    void load();
    void api.templates().then(setTemplates);
    void api.capabilities().then(setCaps).catch(() => undefined);
  }, []);

  const open = (p: Project) => (location.href = `/ide/?project=${p.id}`);

  const create = async (template: string | undefined, name: string) => {
    setBusy(true);
    try {
      const { project } = await api.createProject({ name, template });
      open(project);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل إنشاء المشروع", "error");
      setBusy(false);
    }
  };

  const importZip = async (f: File) => {
    setBusy(true);
    try {
      const r = await api.importZip(f);
      if (r.rejected.length) toasts.push(`تم رفض ${r.rejected.length} ملف لأسباب أمنية (مسارات غير آمنة)`, "error");
      open(r.project);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل رفع الملف", "error");
      setBusy(false);
    }
  };

  const importFolder = async (list: FileList) => {
    const items = Array.from(list).map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
    if (!items.length) return;
    const top = items[0]!.path.split("/")[0] ?? "folder";
    setBusy(true);
    try {
      const { project } = await api.createProject({ name: top, files: [{ path: "README.md", content: `# ${top}\n`, encoding: "utf8" }] });
      // Strip the top-level folder name so paths are project-relative.
      const r = await api.upload(project.id, items.map((i) => ({ ...i, path: i.path.includes("/") ? i.path.slice(i.path.indexOf("/") + 1) : i.path })));
      if (r.skipped.length) toasts.push(`تم تجاهل ${r.skipped.length} ملف غير مدعوم`, "info");
      open(project);
    } catch (e) {
      toasts.push(e instanceof ApiError ? e.messageAr : "فشل رفع المجلد", "error");
      setBusy(false);
    }
  };

  const remove = async (p: Project) => {
    if (!confirm(`حذف المشروع «${p.name}» نهائياً؟`)) return;
    await api.deleteProject(p.id);
    void load();
  };

  const winReady = caps?.compilers.find((c) => c.id === "mingw-gcc")?.available;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-1">
            <a className="btn btn-ghost" href="/learn/">
              <GraduationCap size={16} /> <span className="hidden sm:inline">التعلّم</span>
            </a>
            <ThemeToggle />
            <span className="hidden text-sm text-ink-3 sm:inline">{user.name}</span>
            <button className="btn btn-ghost px-2" onClick={onLogout} title="تسجيل الخروج" aria-label="تسجيل الخروج">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">مشاريعك</h1>
            <p className="mt-1 text-sm text-ink-2">أنشئ مشروعاً من قالب، أو ارفع مشروعاً موجوداً بصيغة ZIP أو كمجلد.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn border-accent/60 text-accent" href="/run/">
              <Zap size={16} /> ارفع ملفك وشغّله
            </a>
            <button className="btn btn-primary" onClick={() => setNewOpen(true)} disabled={busy}>
              <Plus size={16} /> مشروع جديد
            </button>
            <button className="btn" onClick={() => zipRef.current?.click()} disabled={busy}>
              <FileArchive size={16} /> رفع ZIP
            </button>
            <button className="btn" onClick={() => folderRef.current?.click()} disabled={busy}>
              <FolderUp size={16} /> رفع مجلد
            </button>
            <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => e.target.files?.[0] && importZip(e.target.files[0])} />
            <input
              ref={folderRef}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => e.target.files && importFolder(e.target.files)}
            />
          </div>
        </div>

        {caps && (
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className={`chip ${winReady ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>{winReady ? "● عامل بناء Windows EXE متصل" : "● لا يوجد عامل بناء Windows متصل"}</span>
            <span className={`chip ${caps.runBackends.wine ? "border-ok/40 text-ok" : "text-ink-3"}`}>{caps.runBackends.wine ? "● Windows Runner متصل" : "○ Windows Runner غير متصل"}</span>
            <span className={`chip ${caps.ai.available ? "border-ok/40 text-ok" : "text-ink-3"}`}>{caps.ai.available ? "● المساعد الذكي مفعّل" : "○ المساعد الذكي غير مُعدّ"}</span>
          </div>
        )}

        <section className="mt-6">
          {projects === null ? (
            <div className="flex items-center gap-2 text-ink-3">
              <Spinner /> جارٍ التحميل…
            </div>
          ) : projects.length === 0 ? (
            <div className="grid-paper rounded-2xl border border-dashed border-line-strong p-10 text-center">
              <p className="text-lg font-semibold">لا توجد مشاريع بعد</p>
              <p className="mt-2 text-ink-2">ابدأ بقالب «تطبيق Console» إن كانت هذه أول مرة لك مع C++.</p>
              <button className="btn btn-primary mt-5" onClick={() => setNewOpen(true)}>
                <Plus size={16} /> أنشئ أول مشروع
              </button>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id} className="group relative rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong">
                  <a href={`/ide/?project=${p.id}`} className="block">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold">
                        <bdi>{p.name}</bdi>
                      </h3>
                      <span className="chip font-mono" dir="ltr">
                        {p.config.target === "windows-exe" ? ".exe" : "ELF"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-ink-3">
                      <span className="chip font-mono" dir="ltr">{p.config.compiler}</span>
                      <span className="chip font-mono" dir="ltr">{p.config.standard}</span>
                      <span className="chip">{p.fileCount ?? 0} ملف</span>
                    </div>
                    <div className="mt-3 text-xs text-ink-3">آخر تعديل: {rel(p.updatedAt)}</div>
                  </a>
                  <button className="btn btn-ghost absolute bottom-3 end-3 px-2 opacity-60 hover:opacity-100" onClick={() => remove(p)} aria-label={`حذف ${p.name}`} title="حذف">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} templates={templates} onCreate={create} busy={busy} />
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
    </div>
  );
}

function NewProjectDialog({ open, onClose, templates, onCreate, busy }: { open: boolean; onClose: () => void; templates: Template[]; onCreate: (t: string | undefined, name: string) => void; busy: boolean }) {
  const [selected, setSelected] = useState("console-app");
  const [name, setName] = useState("مشروعي الأول");
  return (
    <Modal open={open} onClose={onClose} title="مشروع جديد" wide>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-2">اسم المشروع</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
      </label>
      <p className="mb-2 mt-5 text-sm text-ink-2">اختر قالباً</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={`rounded-lg border p-3 text-start transition ${selected === t.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}
            aria-pressed={selected === t.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{t.nameAr}</span>
              <span className="chip">{LEVEL[t.level]}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-2">{t.descriptionAr}</p>
            <div className="mt-2 truncate font-mono text-[11px] text-ink-3" dir="ltr">
              {t.files.join("  ")}
            </div>
          </button>
        ))}
        <button onClick={() => setSelected("")} className={`rounded-lg border p-3 text-start ${selected === "" ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`} aria-pressed={selected === ""}>
          <span className="font-semibold">مشروع فارغ</span>
          <p className="mt-1 text-xs text-ink-2">ملف main.cpp واحد.</p>
        </button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          إلغاء
        </button>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => onCreate(selected || undefined, name.trim())}>
          {busy && <Spinner />} إنشاء وفتح
        </button>
      </div>
    </Modal>
  );
}
