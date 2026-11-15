"use client";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/common";

const Learn = dynamic(() => import("@/components/Learn").then((m) => m.Learn), {
  ssr: false,
  loading: () => (
    <div className="app-h grid place-items-center text-ink-3">
      <Spinner size={20} />
    </div>
  ),
});

export default function Page() {
  return <Learn />;
}
