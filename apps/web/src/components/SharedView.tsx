"use client";
import { useEffect, useState } from "react";
import { Code2, Copy, Loader2, Play } from "lucide-react";
import type { ProjectFile } from "@mcs/shared";
import { ApiError, api, ensureUser } from "@/lib/api";
import { Brand, ThemeToggle } from "./common";

/** Public read-only view of a shared snapshot, with one-tap "run my own copy". */
export function SharedView() {
  const [id, setId] = useState("");
  const [data, setData] = useState<{ name: string; files: ProjectFile[]; createdAt: string } | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sid = new URLSearchParams(location.search).get("id") ?? "";
    setId(sid);
    api
      .getShare(sid)
      .then((d) => {
        setData(d);
        const main = d.files.findIndex((f) => /(^|\/)main\.(cpp|cc|c)$/.test(f.path));
        setActive(main >= 0 ? main : 0);
      })
      .catch((e) => setError(e instanceof ApiError ? e.messageAr : "الرابط غير موجود"));
  }, []);

  const fork = async (to: "run" | "ide") => {
    setBusy(true);
    try {
      await ensureUser();
      const { project } = await api.fork(id);
      location.href = to === "run" ? `/run/?project=${project.id}` : `/ide/?project=${project.id}`;
    } catch (e) {
      setError(e instanceof ApiError ? e.messageAr : "تعذّر النسخ");
      setBusy(false);
    }
  };

  const file = data?.files[active];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Brand />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {error && <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger">{error}</p>}
        {!data && !error && <Loader2 className="animate-spin text-ink-3" />}
        {data && (
          <>
            <p className="text-sm text-ink-3">كود مشارَك</p>
            <h1 className="mt-1 text-2xl font-bold">
              <bdi>{data.name}</bdi>
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-primary px-5 py-2.5" onClick={() => fork("run")} disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} شغّله الحين
              </button>
              <button className="btn" onClick={() => fork("ide")} disabled={busy}>
                <Code2 size={15} /> انسخه وعدّل عليه
              </button>
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(location.href)}>
                <Copy size={15} /> انسخ الرابط
              </button>
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex gap-1 overflow-x-auto border-b border-line p-1.5" role="tablist">
                {data.files.map((f, i) => (
                  <button key={f.path} role="tab" aria-selected={i === active} onClick={() => setActive(i)} className={`chip whitespace-nowrap font-mono ${i === active ? "border-accent text-accent" : ""}`} dir="ltr">
                    {f.path}
                  </button>
                ))}
              </div>
              <pre className="max-h-[65vh] overflow-auto p-4 text-[13px] leading-6" dir="ltr">
                {file?.content}
              </pre>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
