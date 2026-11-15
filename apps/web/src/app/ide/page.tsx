"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { Spinner } from "@/components/common";

// Monaco and xterm need the browser: load the IDE client-side only.
const IDE = dynamic(() => import("@/components/ide/IDE").then((m) => m.IDE), {
  ssr: false,
  loading: () => (
    <div className="app-h grid place-items-center text-ink-3">
      <Spinner size={20} />
    </div>
  ),
});

function IdeRoute() {
  const params = useSearchParams();
  const projectId = params.get("project");
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .me()
      .then((r) => {
        if (!r.user) location.href = "/";
        else setOk(true);
      })
      .catch(() => (location.href = "/"));
  }, []);
  if (!projectId)
    return (
      <div className="app-h grid place-items-center">
        <a className="btn" href="/">
          اختر مشروعاً
        </a>
      </div>
    );
  if (!ok) return null;
  return <IDE projectId={projectId} />;
}

export default function Page() {
  return (
    <Suspense>
      <IdeRoute />
    </Suspense>
  );
}
