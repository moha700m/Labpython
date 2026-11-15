/**
 * Windows Execution Worker.
 *
 * Backend "wine" (implemented, tested): runs real Windows PE executables on a Linux
 * worker using Wine inside a bubblewrap sandbox, with a fresh per-session Wine
 * prefix, an optional private Xvfb display streamed to the browser, and full
 * clean-up after the session. Wine is a compatibility layer, not Windows: most
 * console and Win32 GUI programs behave correctly, but not all APIs are covered.
 *
 * Backend "windows" (native Windows host): see README.md — the protocol is the
 * same, the isolation layer must be Windows Sandbox / Hyper-V VM per session. It is
 * not implemented in this repository yet and is never advertised as available.
 */
import { detectSandboxMode, executeRun, hasCommand, runWorkerLoop, workerApiFromEnv, type RunBackend, type RunJob } from "@mcs/worker-runtime";
import { createXvfbDisplay } from "./display.ts";

export const wineBackend: RunBackend = {
  name: "Windows Runner (Wine sandbox)",
  command: (name, args) => ["wine", `./${name}`, ...args],
  env: () => ({
    WINEPREFIX: "/work/.wine",
    WINEDEBUG: "-all",
    // No Mono/Gecko installers (no network in the sandbox anyway).
    WINEDLLOVERRIDES: "mscoree,mshtml=",
    WINEARCH: "win64",
  }),
  memoryBytes: null,
  pty: false,
  // A fresh, private Windows prefix per session (deleted with the session directory).
  prepare: { argv: ["wineboot", "--init"], messageAr: "تهيئة بيئة Windows معزولة جديدة لهذه الجلسة…" },
  createDisplay: createXvfbDisplay,
};

export function detectRunCapabilities(): string[] {
  const caps: string[] = [];
  if (hasCommand("wine") && hasCommand("script")) caps.push("run:wine");
  if (caps.length && hasCommand("Xvfb") && hasCommand("xdotool") && hasCommand("import")) caps.push("run:display");
  return caps;
}

async function main() {
  const mode = detectSandboxMode();
  const api = workerApiFromEnv("windows-runner");
  const capabilities = process.env.MCS_CAPABILITIES?.split(",").filter(Boolean) ?? detectRunCapabilities();
  if (capabilities.length === 0) throw new Error("Wine is not installed: cannot provide run:wine");
  await runWorkerLoop<RunJob>(api, {
    name: "windows-runner",
    capabilities,
    concurrency: Number(process.env.MCS_CONCURRENCY ?? 2),
    handle: (job) => executeRun(job, api, mode, wineBackend),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
