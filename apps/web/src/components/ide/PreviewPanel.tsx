"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard, Square } from "lucide-react";
import type { RunSession } from "@/lib/run";

/**
 * Live preview of a GUI program running on the Windows Runner. Frames arrive as
 * JPEG over the run websocket; pointer and keyboard events are sent back and
 * injected into the program's private display.
 */
export function PreviewPanel({ session }: { session: RunSession | null }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [shot, setShot] = useState<string | null>(null);
  const kbd = useRef<HTMLInputElement>(null);
  const lastMove = useRef(0);

  useEffect(() => {
    if (!session) return;
    setShot(null);
    setSize(null);
    return session.subscribe((m) => {
      if (m.type === "frame" && imgRef.current) {
        imgRef.current.src = `data:${m.mime};base64,${m.data}`;
        setSize((s) => (s && s.w === m.width && s.h === m.height ? s : { w: m.width, h: m.height }));
      } else if (m.type === "status") setStatus(m.message ?? m.status);
      else if (m.type === "screenshot") setShot(`data:${m.mime};base64,${m.data}`);
    });
  }, [session]);

  // The image is letterboxed with object-fit: contain — map through the drawn content box.
  const toRemote = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    const W = size?.w ?? 1024;
    const H = size?.h ?? 768;
    let cw = r.width;
    let ch = r.height;
    if (cw / ch > W / H) cw = ch * (W / H);
    else ch = cw / (W / H);
    const ox = r.left + (r.width - cw) / 2;
    const oy = r.top + (r.height - ch) / 2;
    return { x: Math.max(0, Math.min(W - 1, ((e.clientX - ox) / cw) * W)), y: Math.max(0, Math.min(H - 1, ((e.clientY - oy) / ch) * H)) };
  };
  const btn = (b: number) => (b === 2 ? 3 : b === 1 ? 2 : 0) as 0 | 2 | 3;

  if (!session || !session.display)
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-ink-3">
        <div>
          <p>المعاينة الحية تعمل مع برامج الواجهة الرسومية (نظام Windows الفرعي = Windows).</p>
          <p className="mt-2">برامج Console تظهر في تبويب «الطرفية».</p>
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
        <span className={`size-2 rounded-full ${session.active ? "bg-ok" : "bg-ink-3"}`} />
        <span className="truncate text-ink-2">{status}</span>
        <div className="ms-auto flex gap-1">
          <button className="btn btn-ghost px-2 py-1" title="لوحة المفاتيح" onClick={() => kbd.current?.focus()} aria-label="فتح لوحة المفاتيح">
            <Keyboard size={14} />
          </button>
          <button className="btn btn-ghost px-2 py-1" title="لقطة شاشة" onClick={() => session.send({ type: "screenshot" })} disabled={!session.active} aria-label="لقطة شاشة">
            <Camera size={14} />
          </button>
          <button className="btn btn-ghost px-2 py-1 text-danger" title="إيقاف الجلسة" onClick={() => session.stop()} disabled={!session.active} aria-label="إيقاف">
            <Square size={14} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black" dir="ltr">
        {!size && <div className="absolute inset-0 grid place-items-center text-sm text-ink-3">في انتظار أول إطار من نافذة البرنامج…</div>}
        <img
          ref={imgRef}
          alt="معاينة نافذة البرنامج"
          className="h-full w-full touch-none select-none object-contain"
          style={{ visibility: size ? "visible" : "hidden", cursor: "crosshair" }}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            const p = toRemote(e);
            session.send({ type: "mouse", ...p, button: btn(e.button), action: "down" });
          }}
          onPointerUp={(e) => {
            const p = toRemote(e);
            session.send({ type: "mouse", ...p, button: btn(e.button), action: "up" });
          }}
          onPointerMove={(e) => {
            const t = performance.now();
            if (t - lastMove.current < 50) return;
            lastMove.current = t;
            session.send({ type: "mouse", ...toRemote(e), button: 0, action: "move" });
          }}
        />
        <input
          ref={kbd}
          className="absolute -top-10 opacity-0"
          aria-label="إدخال لوحة المفاتيح للبرنامج"
          autoCapitalize="off"
          autoCorrect="off"
          onKeyDown={(e) => {
            if (e.key.length > 1) {
              e.preventDefault();
              session.send({ type: "key", key: e.key, action: "press" });
            }
          }}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            for (const ch of v) session.send({ type: "key", key: ch, action: "press" });
            (e.target as HTMLInputElement).value = "";
          }}
        />
      </div>
      {shot && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs">
          <span className="text-ink-2">تم التقاط لقطة شاشة.</span>
          <a className="btn px-2 py-1" href={shot} download="screenshot.png">
            تنزيل PNG
          </a>
        </div>
      )}
    </div>
  );
}
