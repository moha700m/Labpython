import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type WebSocket from "ws";
import { LIMITS, type BuildConfig, type RunClientMessage, type RunRequest, type RunServerMessage } from "@mcs/shared";
import { explainRuntimeExit } from "@mcs/localization";
import type { WorkerApi } from "./api.ts";
import { runSandboxed, type SandboxBind, type SandboxMode } from "./sandbox.ts";
import { workRoot } from "./loop.ts";

export interface RunJob {
  id: string;
  type: "run";
  config: BuildConfig;
  run: RunRequest;
  artifact: { id: string; fileName: string; format: string; sha256: string };
}

/** Optional virtual display for GUI programs (frames out, mouse/keyboard in). */
export interface DisplaySession {
  env: Record<string, string>;
  binds: SandboxBind[];
  start(send: (m: RunServerMessage) => void): Promise<void>;
  input(m: RunClientMessage): void;
  screenshot(): Promise<string | null>;
  stop(): Promise<void>;
}

export interface RunBackend {
  name: string;
  /** Returns the argv to execute inside the sandbox for the given artifact. */
  command(artifactName: string, args: string[]): string[];
  env(): Record<string, string>;
  /** Address-space limit; Wine needs null (it reserves large ranges up front). */
  memoryBytes: number | null;
  /**
   * true: run under a pseudo-terminal (real tty echo, line-buffered output).
   * false: plain pipes; the browser terminal does local line editing/echo.
   * Wine uses pipes because its tty console backend mangles UTF-8 output.
   */
  pty: boolean;
  /** Optional silent preparation step run in the same sandbox dir first (e.g. creating a Wine prefix). */
  prepare?: { argv: string[]; messageAr: string };
  createDisplay?(): Promise<DisplaySession>;
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Execute a user program in the sandbox, wired to a pseudo-terminal (util-linux
 * `script`) so interactive console programs behave like in a real terminal, and
 * relay its I/O over the worker websocket.
 */
export async function executeRun(job: RunJob, api: WorkerApi, mode: SandboxMode, backend: RunBackend): Promise<void> {
  const started = Date.now();
  const root = await mkdtemp(join(workRoot(), "mcs-run-"));
  let ws: WebSocket | null = null;
  let display: DisplaySession | null = null;
  const send = (m: RunServerMessage) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  let exitCode: number | null = null;
  let summaryAr = "";
  try {
    ws = await api.openRunSocket(job.id);
    send({ type: "status", status: "starting", message: "تجهيز بيئة التشغيل المعزولة…" });
    const bytes = await api.downloadArtifact(job.artifact.id);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== job.artifact.sha256) throw new Error("artifact checksum mismatch");
    const name = job.artifact.fileName.replace(/[^A-Za-z0-9_.-]/g, "_");
    await writeFile(join(root, name), bytes);
    await chmod(join(root, name), 0o755);

    if (backend.prepare) {
      send({ type: "status", status: "starting", message: backend.prepare.messageAr });
      const prep = runSandboxed(
        {
          workDir: root,
          argv: backend.prepare.argv,
          env: backend.env(),
          limits: { timeoutMs: 120_000, memoryBytes: backend.memoryBytes, cpuSeconds: 120, maxProcesses: LIMITS.runMaxProcesses, maxFileBytes: 512 * 1024 * 1024, maxOutputBytes: 1024 * 1024 },
        },
        mode,
      );
      const pr = await prep.done;
      if (pr.exitCode !== 0) throw new Error(`preparation failed (${pr.exitCode})`);
    }

    if (job.run.display) {
      if (!backend.createDisplay) throw new Error("هذا المشغّل لا يدعم الواجهات الرسومية");
      display = await backend.createDisplay();
    }
    const argv = backend.command(name, job.run.args.slice(0, 20));
    const ptyCmd = backend.pty ? ["script", "-q", "-e", "-f", "-c", "exec " + argv.map(shQuote).join(" "), "/dev/null"] : argv;
    const userEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(job.config.runEnv ?? {})) if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !/^(PATH|HOME|LD_|WINE)/.test(k)) userEnv[k] = v;

    const h = runSandboxed(
      {
        workDir: root,
        argv: ptyCmd,
        env: { TERM: "xterm-256color", COLUMNS: "100", LINES: "30", ...userEnv, ...backend.env(), ...(display?.env ?? {}) },
        binds: display?.binds,
        stdin: true,
        limits: {
          timeoutMs: LIMITS.runTimeoutMs,
          memoryBytes: backend.memoryBytes,
          cpuSeconds: LIMITS.runCpuSeconds,
          maxProcesses: LIMITS.runMaxProcesses,
          maxFileBytes: 64 * 1024 * 1024,
          maxOutputBytes: LIMITS.runMaxOutputBytes,
        },
        onStdout: (d) => send({ type: "stdout", data: d }),
        onStderr: (d) => send({ type: "stderr", data: d }),
      },
      mode,
    );
    let stopped = false;
    ws.on("message", async (raw) => {
      let m: RunClientMessage;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === "stdin") h.write(m.data);
      else if (m.type === "stop") {
        stopped = true;
        h.kill();
      } else if (m.type === "screenshot") {
        const png = await display?.screenshot();
        if (png) send({ type: "screenshot", mime: "image/png", data: png });
      } else display?.input(m);
    });
    ws.on("close", () => {
      // Browser relay gone and API connection dropped: stop the program.
      stopped = true;
      h.kill();
    });
    if (display) await display.start(send);
    send({ type: "status", status: "running", message: backend.name, inputMode: backend.pty ? "tty" : "line" });
    const r = await h.done;
    exitCode = r.exitCode;
    const sig = r.signal ?? (r.exitCode !== null && r.exitCode > 128 ? signalName(r.exitCode - 128) : null);
    const explain = explainRuntimeExit(r.exitCode, sig);
    summaryAr = stopped
      ? "أوقف المستخدم البرنامج"
      : r.timedOut
        ? `تم إيقاف البرنامج بعد تجاوز ${LIMITS.runTimeoutMs / 60000} دقائق`
        : `انتهى البرنامج برمز ${r.exitCode}${explain ? " — " + explain : ""}`;
    send({ type: "status", status: stopped ? "stopped" : "exited", exitCode: r.exitCode, message: summaryAr });
  } catch (e) {
    summaryAr = `تعذّر تشغيل البرنامج: ${(e as Error).message}`;
    send({ type: "status", status: "error", message: summaryAr });
  } finally {
    await display?.stop().catch(() => undefined);
    ws?.close();
    await api.complete(job.id, { status: exitCode === 0 ? "succeeded" : "failed", summaryAr, exitCode, durationMs: Date.now() - started }).catch(() => undefined);
    // Clean-up: the whole per-session directory (including any Wine prefix) is removed.
    await rm(root, { recursive: true, force: true });
  }
}

function signalName(n: number): string | null {
  return ({ 4: "SIGILL", 6: "SIGABRT", 8: "SIGFPE", 9: "SIGKILL", 11: "SIGSEGV", 24: "SIGXCPU" } as Record<number, string>)[n] ?? null;
}
