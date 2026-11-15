/**
 * Linux Build Worker — compiles user projects inside bubblewrap sandboxes.
 *  - build:gcc, build:clang         → Linux ELF
 *  - build:mingw-gcc                → native Windows PE (.exe/.dll) via MinGW-w64 cross compiler
 *  - run:native                     → runs Linux ELF console programs (interactive, sandboxed)
 * The worker never trusts the API with execution: it only pulls jobs and pushes results.
 */
import { TOOLCHAINS } from "@mcs/compiler";
import { LIMITS } from "@mcs/shared";
import { detectSandboxMode, executeRun, hasCommand, runWorkerLoop, workerApiFromEnv, type RunBackend, type RunJob } from "@mcs/worker-runtime";
import { executeBuild, type BuildJob } from "./build.ts";

export const nativeBackend: RunBackend = {
  name: "Linux sandbox (native)",
  command: (name, args) => [`./${name}`, ...args],
  env: () => ({}),
  memoryBytes: LIMITS.runMemoryBytes,
  pty: true,
};

export function detectBuildCapabilities(): string[] {
  const caps: string[] = [];
  for (const t of Object.values(TOOLCHAINS)) {
    if (t.platform !== "linux") continue;
    if (hasCommand(t.cxx) && hasCommand(t.cc)) caps.push(`build:${t.id}`);
  }
  if (process.env.MCS_ENABLE_NATIVE_RUN !== "0" && hasCommand("script")) caps.push("run:native");
  return caps;
}

async function main() {
  const mode = detectSandboxMode();
  if (mode === "unsafe-none") console.warn("⚠  MCS_SANDBOX=unsafe-none: user code is NOT isolated. Never use this in production.");
  const api = workerApiFromEnv("linux-builder");
  const capabilities = (process.env.MCS_CAPABILITIES?.split(",").filter(Boolean) ?? detectBuildCapabilities());
  await runWorkerLoop<BuildJob | RunJob>(api, {
    name: "linux-builder",
    capabilities,
    concurrency: Number(process.env.MCS_CONCURRENCY ?? 2),
    handle: async (job) => {
      if (job.type === "build") await executeBuild(job, api, mode);
      else await executeRun(job, api, mode, nativeBackend);
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
