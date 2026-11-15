"use client";
import { useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Check, Sparkles, X } from "lucide-react";
import type { Diagnostic } from "@mcs/shared";
import { languageForPath } from "@mcs/shared";
import { ApiError, api, type ProposedChange } from "@/lib/api";
import { Modal, Spinner } from "../common";

const TASKS: { id: string; labelAr: string }[] = [
  { id: "explain", labelAr: "اشرح الكود" },
  { id: "fix", labelAr: "أصلح الأخطاء" },
  { id: "review", labelAr: "راجع الكود" },
  { id: "optimize", labelAr: "حسّن الأداء" },
  { id: "tests", labelAr: "اقترح اختبارات" },
  { id: "stacktrace", labelAr: "اشرح الانهيار" },
  { id: "generate", labelAr: "أنشئ مشروعاً من وصف" },
  { id: "teach", labelAr: "علّمني خطوة بخطوة" },
];

interface Msg {
  role: "user" | "assistant";
  text: string;
  changes?: ProposedChange[];
}

export function AssistantPanel({
  projectId,
  available,
  activeFile,
  getSelection,
  getFileContent,
  diagnostics,
  buildLog,
  theme,
  onApply,
}: {
  projectId: string;
  available: boolean;
  activeFile: string | null;
  getSelection: () => string;
  getFileContent: (path: string) => Promise<string | null>;
  diagnostics: Diagnostic[];
  buildLog: string;
  theme: "dark" | "light";
  onApply: (changes: ProposedChange[]) => Promise<void>;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [task, setTask] = useState("chat");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ changes: ProposedChange[]; originals: Record<string, string>; accepted: Set<string> } | null>(null);

  const ask = async (t: string, text: string) => {
    if (!text.trim() && t === "chat") return;
    const label = TASKS.find((x) => x.id === t)?.labelAr;
    setMessages((m) => [...m, { role: "user", text: text || label || "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.assistant(projectId, {
        task: t,
        message: text || label || "",
        activeFile: activeFile ?? undefined,
        selection: getSelection() || undefined,
        diagnostics: diagnostics.slice(0, 50).map(({ file, line, column, severity, message }) => ({ file, line, column, severity, message })),
        buildLog: buildLog.slice(-20000) || undefined,
      });
      setMessages((m) => [...m, { role: "assistant", text: res.answerAr, changes: res.changes }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e instanceof ApiError ? e.messageAr : "تعذّر الوصول إلى المساعد" }]);
    } finally {
      setBusy(false);
    }
  };

  const openReview = async (changes: ProposedChange[]) => {
    const originals: Record<string, string> = {};
    for (const c of changes) originals[c.path] = (await getFileContent(c.path)) ?? "";
    setReview({ changes, originals, accepted: new Set(changes.map((c) => c.path)) });
  };

  if (!available)
    return (
      <div className="p-4 text-sm leading-7 text-ink-2">
        <div className="mb-2 flex items-center gap-2 font-semibold text-ink">
          <Sparkles size={16} className="text-accent" /> المساعد الذكي
        </div>
        المساعد غير مُفعّل على هذا الخادم. يفعّله مسؤول الخادم بضبط مفتاح مزوّد الذكاء الاصطناعي في متغيرات البيئة (راجع DEPLOYMENT.md) — لا يُطلب أي مفتاح منك هنا.
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs font-semibold text-ink-3">
        <Sparkles size={14} className="text-accent" /> مساعد C++ — يقترح فقط، ولا يغيّر ملفاتك إلا بموافقتك
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line p-2">
        {TASKS.map((t) => (
          <button key={t.id} className="chip hover:border-accent hover:text-accent" disabled={busy} onClick={() => (t.id === "generate" ? setTask("generate") : ask(t.id, ""))}>
            {t.labelAr}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 scroll-thin">
        {messages.length === 0 && <p className="text-sm text-ink-3">اسأل عن أي شيء في مشروعك، أو حدّد جزءاً من الكود واختر «اشرح الكود».</p>}
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg p-3 text-sm leading-7 ${m.role === "user" ? "bg-surface-3" : "border border-line bg-surface"}`}>
            <div className="whitespace-pre-wrap break-words [unicode-bidi:plaintext]">{m.text}</div>
            {!!m.changes?.length && (
              <div className="mt-3 rounded-md border border-accent/40 bg-accent-soft p-2">
                <div className="text-xs font-semibold">تعديلات مقترحة على {m.changes.length} ملف:</div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {m.changes.map((c) => (
                    <li key={c.path}>
                      <span className="chip me-1">{c.action === "create" ? "جديد" : c.action === "delete" ? "حذف" : "تعديل"}</span>
                      <bdi dir="ltr" className="font-mono">
                        {c.path}
                      </bdi>{" "}
                      — {c.reasonAr}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-primary mt-2 px-2.5 py-1 text-xs" onClick={() => openReview(m.changes!)}>
                  مراجعة الفروقات قبل التطبيق
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-3">
            <Spinner /> المساعد يفكّر…
          </div>
        )}
      </div>
      <form
        className="border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(task, input);
          setTask("chat");
        }}
      >
        {task === "generate" && <p className="mb-1 text-xs text-accent">صف المشروع الذي تريده بالعربية، وسيقترح المساعد ملفاته.</p>}
        <div className="flex gap-2">
          <textarea
            className="field h-16 resize-none text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={task === "generate" ? "مثال: برنامج لإدارة درجات الطلاب مع حفظها في ملف" : "اكتب سؤالك…"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(task, input);
                setTask("chat");
              }
            }}
          />
          <button className="btn btn-primary self-end" disabled={busy}>
            إرسال
          </button>
        </div>
      </form>

      <Modal open={!!review} onClose={() => setReview(null)} title="مراجعة التعديلات المقترحة" wide>
        {review && (
          <div className="space-y-4">
            {review.changes.map((c) => (
              <div key={c.path} className="rounded-lg border border-line">
                <label className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={review.accepted.has(c.path)}
                    onChange={(e) =>
                      setReview((r) => {
                        if (!r) return r;
                        const a = new Set(r.accepted);
                        if (e.target.checked) a.add(c.path);
                        else a.delete(c.path);
                        return { ...r, accepted: a };
                      })
                    }
                  />
                  <bdi dir="ltr" className="font-mono">
                    {c.path}
                  </bdi>
                  <span className="text-ink-3">— {c.reasonAr}</span>
                </label>
                <div className="h-72" dir="ltr">
                  <DiffEditor
                    original={review.originals[c.path] ?? ""}
                    modified={c.action === "delete" ? "" : c.content}
                    language={languageForPath(c.path)}
                    theme={theme === "dark" ? "vs-dark" : "vs"}
                    options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, automaticLayout: true }}
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setReview(null)}>
                <X size={14} /> رفض الكل
              </button>
              <button
                className="btn btn-primary"
                disabled={review.accepted.size === 0}
                onClick={async () => {
                  await onApply(review.changes.filter((c) => review.accepted.has(c.path)));
                  setReview(null);
                }}
              >
                <Check size={14} /> تطبيق المحدّد ({review.accepted.size})
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
