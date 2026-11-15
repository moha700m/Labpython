/**
 * Muhammad C++ Studio — desktop (Windows) entry point.
 *
 * One Node process runs:
 *  - the normal API + web UI, bound to 127.0.0.1 only;
 *  - an in-process worker that builds with the bundled native MinGW-w64 toolchain and runs the
 *    resulting EXE natively on this PC (GUI programs open as real windows on the desktop).
 *
 * This is the user's own code on the user's own computer — exactly like Visual Studio or any IDE —
 * so there is no namespace sandbox; timeouts, output caps and process-tree kill still apply.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../../api/src/server.ts";
import { loadConfig } from "../../api/src/config.ts";
import { executeBuild, type BuildJob } from "../../../workers/linux-builder/src/build.ts";
import { WorkerApi, executeRun, runWorkerLoop, type RunBackend, type RunJob } from "@mcs/worker-runtime";

const HOME = process.env.MCS_HOME ?? process.cwd(); // install directory (set by the launcher)
const DATA = process.env.MCS_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? HOME, "MuhammadCppStudio");
const PORT = Number(process.env.MCS_PORT ?? 47321);
mkdirSync(DATA, { recursive: true });

// Bundled toolchain first on PATH: g++, gcc, make, windres, ar (w64devkit) and cmake.
const toolDirs = [join(HOME, "mingw", "bin"), join(HOME, "cmake", "bin")].filter((d) => existsSync(d));
process.env.PATH = [...toolDirs, process.env.PATH ?? ""].join(process.platform === "win32" ? ";" : ":");
process.env.MCS_WORK_ROOT ??= join(DATA, "work");
process.env.MCS_TEMPLATES_DIR ??= join(HOME, "app", "templates");

const workerToken = randomBytes(32).toString("hex");
const config = loadConfig({
  dataDir: DATA,
  port: PORT,
  host: "127.0.0.1",
  webDir: process.env.MCS_WEB_DIR ?? join(HOME, "app", "web"),
  workerToken,
  logLevel: process.env.LOG_LEVEL ?? "warn",
  cookieSecure: false,
});

const app = await buildApp({ config });
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`Muhammad C++ Studio: http://127.0.0.1:${PORT}/run/`);
setInterval(() => app.ctx.jobs.reapStale(), 30_000).unref();

/** Runs the built EXE directly on this Windows PC. GUI programs show a normal window. */
const windowsNative: RunBackend = {
  name: "Windows — هذا الجهاز",
  command: (name, args, dir) => [join(dir, name), ...args],
  env: () => ({}),
  memoryBytes: null,
  pty: false,
};

const api = new WorkerApi({ baseUrl: `http://127.0.0.1:${PORT}`, token: workerToken, workerId: "desktop-local" });
const capabilities = process.platform === "win32" ? ["build:mingw-gcc", "run:windows"] : [];
if (capabilities.length) {
  void runWorkerLoop<BuildJob | RunJob>(api, {
    name: "desktop-worker",
    capabilities,
    concurrency: 2,
    handle: async (job) => {
      if (job.type === "build") await executeBuild(job, api, "host", { native: true });
      else await executeRun({ ...job, run: { ...job.run, display: false } }, api, "host", windowsNative);
    },
  });
} else {
  console.warn("Not on Windows: the desktop worker is disabled (use the server workers on Linux).");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void app.close().then(() => process.exit(0)));
