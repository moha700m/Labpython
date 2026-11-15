"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-2 font-bold text-ink" aria-label="Muhammad C++ Studio — الرئيسية">
      <span className="grid size-8 place-items-center rounded-lg border border-line bg-surface-2 font-mono text-sm" dir="ltr">
        <span className="text-accent">C</span>
        <span className="text-teal">++</span>
      </span>
      {!compact && (
        <span className="leading-tight" dir="ltr">
          Muhammad <span className="text-accent">C++</span> Studio
        </span>
      )}
    </a>
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("mcs-theme", next);
    } catch {
      /* private mode */
    }
  };
  return { theme, toggle };
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button className="btn btn-ghost px-2" onClick={toggle} title={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"} aria-label="تبديل السمة">
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92dvh] w-full overflow-auto rounded-xl border border-line bg-surface shadow-2xl scroll-thin ${wide ? "max-w-4xl" : "max-w-lg"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <h2 className="font-bold">{title}</h2>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="إغلاق">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Toasts({ items, dismiss }: { items: { id: number; text: string; kind: "ok" | "error" | "info" }[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-3">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-xl cursor-pointer rounded-lg border px-4 py-2 text-sm shadow-lg ${
            t.kind === "error" ? "border-danger/40 bg-surface text-danger" : t.kind === "ok" ? "border-ok/40 bg-surface text-ok" : "border-line bg-surface text-ink"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

let toastSeq = 0;
export function useToasts() {
  const [items, setItems] = useState<{ id: number; text: string; kind: "ok" | "error" | "info" }[]>([]);
  const dismiss = (id: number) => setItems((x) => x.filter((t) => t.id !== id));
  const push = (text: string, kind: "ok" | "error" | "info" = "info") => {
    const id = ++toastSeq;
    setItems((x) => [...x.slice(-3), { id, text, kind }]);
    setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3500);
  };
  return { items, push, dismiss };
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: size, height: size }} aria-hidden />;
}
