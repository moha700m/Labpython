"use client";
import { useEffect, useState } from "react";
import type { BuildConfig } from "@mcs/shared";
import type { Capabilities } from "@/lib/api";
import { Modal } from "../common";

const PRESETS: { id: string; labelAr: string; patch: Partial<BuildConfig> }[] = [
  { id: "win-debug", labelAr: "Windows EXE — Debug", patch: { compiler: "mingw-gcc", target: "windows-exe", mode: "debug" } },
  { id: "win-release", labelAr: "Windows EXE — Release", patch: { compiler: "mingw-gcc", target: "windows-exe", mode: "release" } },
  { id: "linux-gcc", labelAr: "Linux — GCC", patch: { compiler: "gcc", target: "linux-elf", mode: "debug" } },
  { id: "linux-clang", labelAr: "Linux — Clang", patch: { compiler: "clang", target: "linux-elf", mode: "debug" } },
];

// Defined at module level so inputs keep focus while typing (no remount per render).
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink-2">
        {label} {hint && <span className="text-xs text-ink-3">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function BuildSettings({
  open,
  onClose,
  config,
  caps,
  beginner,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  config: BuildConfig;
  caps: Capabilities | null;
  beginner: boolean;
  onSave: (c: BuildConfig) => void;
}) {
  const [c, setC] = useState(config);
  const [flags, setFlags] = useState(config.extraFlags.join(" "));
  const [link, setLink] = useState(config.linkFlags.join(" "));
  const [env, setEnv] = useState(Object.entries(config.runEnv).map(([k, v]) => `${k}=${v}`).join("\n"));
  useEffect(() => {
    if (open) {
      setC(config);
      setFlags(config.extraFlags.join(" "));
      setLink(config.linkFlags.join(" "));
      setEnv(Object.entries(config.runEnv).map(([k, v]) => `${k}=${v}`).join("\n"));
    }
  }, [open, config]);

  const set = <K extends keyof BuildConfig>(k: K, v: BuildConfig[K]) => setC((x) => ({ ...x, [k]: v }));
  const setCompiler = (id: BuildConfig["compiler"]) => setC((x) => ({ ...x, compiler: id, target: id === "mingw-gcc" || id === "msvc" ? "windows-exe" : "linux-elf" }));

  const save = () => {
    const runEnv: Record<string, string> = {};
    for (const line of env.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) runEnv[line.slice(0, i).trim()] = line.slice(i + 1);
    }
    onSave({ ...c, extraFlags: flags.split(/\s+/).filter(Boolean), linkFlags: link.split(/\s+/).filter(Boolean), runEnv });
  };

  return (
    <Modal open={open} onClose={onClose} title="إعدادات البناء" wide>
      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} className="btn px-2.5 py-1 text-xs" onClick={() => setC((x) => ({ ...x, ...p.patch }))}>
            {p.labelAr}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="المترجم">
          <select className="field" value={c.compiler} onChange={(e) => setCompiler(e.target.value as BuildConfig["compiler"])}>
            {(caps?.compilers ?? []).map((t) => (
              <option key={t.id} value={t.id} disabled={!t.available}>
                {t.labelAr} {t.available ? "" : "— غير متصل"}
              </option>
            ))}
          </select>
        </Row>
        <Row label="معيار C++">
          <select className="field" value={c.standard} onChange={(e) => set("standard", e.target.value as BuildConfig["standard"])} dir="ltr">
            <option value="c++17">C++17</option>
            <option value="c++20">C++20</option>
            <option value="c++23">C++23</option>
            <option value="c++26">C++26 (تجريبي حسب المترجم)</option>
          </select>
        </Row>
        <Row label="وضع البناء">
          <select className="field" value={c.mode} onChange={(e) => set("mode", e.target.value as BuildConfig["mode"])}>
            <option value="debug">Debug — رموز تصحيح بدون تحسين</option>
            <option value="release">Release — تحسين -O2 وملف أصغر</option>
          </select>
        </Row>
        <Row label="نظام Windows الفرعي" hint="لملفات EXE">
          <select className="field" value={c.windowsSubsystem} onChange={(e) => set("windowsSubsystem", e.target.value as BuildConfig["windowsSubsystem"])} disabled={c.target !== "windows-exe"}>
            <option value="console">Console — نافذة نصية</option>
            <option value="windows">Windows — واجهة رسومية (WinMain)</option>
          </select>
        </Row>
        <Row label="اسم الملف الناتج">
          <input className="field font-mono" dir="ltr" value={c.outputName} onChange={(e) => set("outputName", e.target.value.replace(/[^A-Za-z0-9_.-]/g, ""))} maxLength={64} />
        </Row>
        {!beginner && (
          <>
            <Row label="نوع المشروع">
              <select className="field" value={c.kind} onChange={(e) => set("kind", e.target.value as BuildConfig["kind"])}>
                <option value="auto">تلقائي (CMake ← Makefile ← ملفات)</option>
                <option value="single">ملف واحد</option>
                <option value="multi">ملفات متعددة</option>
                <option value="cmake">CMake</option>
                <option value="make">Makefile</option>
              </select>
            </Row>
            <Row label="نوع المخرجات">
              <select className="field" value={c.output} onChange={(e) => set("output", e.target.value as BuildConfig["output"])}>
                <option value="executable">برنامج تنفيذي</option>
                <option value="static-lib">مكتبة ساكنة (.a)</option>
                <option value="shared-lib">مكتبة ديناميكية (.dll / .so)</option>
              </select>
            </Row>
            <Row label="خيارات المترجم" hint="مثال: -Wall -O3 -DDEBUG">
              <input className="field font-mono" dir="ltr" value={flags} onChange={(e) => setFlags(e.target.value)} />
            </Row>
            <Row label="خيارات الربط" hint="مثال: -lws2_32">
              <input className="field font-mono" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} />
            </Row>
            <div className="sm:col-span-2">
              <Row label="متغيرات البيئة عند التشغيل" hint="سطر لكل متغير NAME=value">
                <textarea className="field h-20 font-mono" dir="ltr" value={env} onChange={(e) => setEnv(e.target.value)} />
              </Row>
            </div>
          </>
        )}
      </div>
      <p className="mt-4 text-xs leading-5 text-ink-3">
        الخيارات تُفحص على الخادم ضد قائمة مسموحة: خيارات مثل <bdi dir="ltr" className="font-mono">-fplugin</bdi> أو <bdi dir="ltr" className="font-mono">@file</bdi> مرفوضة لأسباب أمنية.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          إلغاء
        </button>
        <button className="btn btn-primary" onClick={save}>
          حفظ الإعدادات
        </button>
      </div>
    </Modal>
  );
}
