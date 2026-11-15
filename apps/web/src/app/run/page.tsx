"use client";
import dynamic from "next/dynamic";

const QuickRun = dynamic(() => import("@/components/QuickRun").then((m) => m.QuickRun), { ssr: false });

export default function Page() {
  return <QuickRun />;
}
