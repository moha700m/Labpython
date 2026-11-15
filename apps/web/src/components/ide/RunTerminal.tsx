"use client";
import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Square } from "lucide-react";
import type { RunSession } from "@/lib/run";

/**
 * Program console bound to a run session.
 *
 * Rendered as HTML (not a canvas terminal) so Arabic and mixed-direction text is
 * shaped and ordered correctly by the browser — canvas terminals draw Arabic
 * letters disconnected and in the wrong order.
 *  - "tty" input mode (native Linux runs): the pseudo-terminal echoes input itself.
 *  - "line" input mode (Wine runs use pipes): we echo the line locally.
 */
type Line = { text: string; kind: "out" | "err" | "in" | "status-ok" | "status-warn" | "status-err" };

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]/g;

export function RunTerminal({ session }: { session: RunSession | null; theme?: "dark" | "light" }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<{ text: string; kind: Line["kind"] } | null>(null);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Console model shared by the output handler and the input echo.
  const model = useRef<{ committed: Line[]; partial: string; partialKind: "out" | "err" }>({ committed: [], partial: "", partialKind: "out" });
  const render = () => {
    const m = model.current;
    if (m.committed.length > 4000) m.committed = m.committed.slice(-3000);
    setLines(m.partial ? [...m.committed, { text: m.partial, kind: m.partialKind }] : [...m.committed]);
  };
  const commitPartial = () => {
    const m = model.current;
    if (m.partial) m.committed.push({ text: m.partial, kind: m.partialKind });
    m.partial = "";
  };

  useEffect(() => {
    model.current = { committed: [], partial: "", partialKind: "out" };
    setLines([]);
    setStatus(null);
    if (!session) return;
    const unsub = session.subscribe((msg) => {
      const m = model.current;
      if (msg.type === "stdout" || msg.type === "stderr") {
        const kind = msg.type === "stdout" ? "out" : "err";
        if (kind !== m.partialKind) commitPartial();
        m.partialKind = kind;
        const parts = (m.partial + msg.data.replace(ANSI, "")).replace(/\r\n/g, "\n").split("\n");
        m.partial = parts.pop() ?? "";
        for (const p of parts) m.committed.push({ text: p.includes("\r") ? p.slice(p.lastIndexOf("\r") + 1) : p, kind });
        if (m.partial.includes("\r")) m.partial = m.partial.slice(m.partial.lastIndexOf("\r") + 1);
        render();
      } else if (msg.type === "status") {
        const kind: Line["kind"] = msg.status === "error" ? "status-err" : msg.status === "exited" && msg.exitCode === 0 ? "status-ok" : "status-warn";
        setStatus({ text: msg.message ?? msg.status, kind });
        if (msg.status === "exited" || msg.status === "stopped" || msg.status === "error") {
          commitPartial();
          m.committed.push({ text: msg.message ?? msg.status, kind });
          render();
        }
      }
    });
    setTimeout(() => inputRef.current?.focus(), 50);
    return unsub;
     
  }, [session]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.active) return;
    if (session.inputMode === "tty") session.send({ type: "stdin", data: input + "\r" });
    else {
      // Pipes do not echo: show the typed line after the prompt, like a real console.
      session.send({ type: "stdin", data: input + "\n" });
      const m = model.current;
      if (m.partial && m.partialKind === "out") {
        m.committed.push({ text: m.partial, kind: "out" });
        m.partial = "";
        const last = m.committed[m.committed.length - 1]!;
        m.committed[m.committed.length - 1] = { ...last, text: last.text + input };
      } else m.committed.push({ text: input, kind: "in" });
      render();
    }
    setInput("");
  };

  const color: Record<Line["kind"], string> = {
    out: "text-ink",
    err: "text-danger",
    in: "text-teal",
    "status-ok": "text-ok",
    "status-warn": "text-accent",
    "status-err": "text-danger",
  };

  return (
    <div className="flex h-full flex-col">
      {session && status && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1 text-xs">
          <span className={`size-2 rounded-full ${session.active ? "animate-pulse bg-ok" : "bg-ink-3"}`} />
          <span className={color[status.kind]}>{status.text}</span>
          {session.active && (
            <button className="btn ms-auto px-2 py-0.5 text-xs text-danger" onClick={() => session.stop()}>
              <Square size={12} /> إيقاف
            </button>
          )}
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[13px] leading-6 scroll-thin" onClick={() => inputRef.current?.focus()} role="log" aria-live="polite" aria-label="مخرجات البرنامج">
        {!session && <p className="font-sans text-sm text-ink-3">اضغط «تشغيل» (F5) لبدء البرنامج هنا. عندما يطلب البرنامج إدخالاً اكتبه في السطر بالأسفل واضغط Enter.</p>}
        {lines.map((l, i) => (
          <div key={i} dir="auto" className={`whitespace-pre-wrap break-words text-start ${color[l.kind]} ${l.kind.startsWith("status") ? "mt-1 font-sans text-xs" : ""}`} style={{ unicodeBidi: "plaintext" }}>
            {l.text || " "}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-line p-2">
        <span className="font-mono text-xs text-ink-3" dir="ltr">
          stdin›
        </span>
        <input
          ref={inputRef}
          className="field py-1.5 font-mono text-sm"
          dir="auto"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={session?.active ? "اكتب الإدخال ثم Enter" : "البرنامج غير قيد التشغيل"}
          aria-label="إدخال للبرنامج"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={!session?.active}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === "c" && session?.active && !input) {
              e.preventDefault();
              session.stop();
            }
            if (e.ctrlKey && e.key === "d" && session?.active) {
              e.preventDefault();
              session.send({ type: "stdin", data: session.inputMode === "tty" ? "\x04" : input });
            }
          }}
        />
        <button className="btn btn-primary px-2.5" disabled={!session?.active} aria-label="إرسال الإدخال">
          <CornerDownLeft size={15} className="rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}
