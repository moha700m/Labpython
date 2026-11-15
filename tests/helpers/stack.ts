import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { buildApp } from "../../apps/api/src/server.ts";
import { loadConfig } from "../../apps/api/src/config.ts";

const ROOT = join(import.meta.dirname, "../..");

export interface Stack {
  base: string;
  token: string;
  close(): Promise<void>;
  app: Awaited<ReturnType<typeof buildApp>>;
}

/** Start the real API in-process on a random port, optionally with real worker processes. */
export async function startStack(opts: { workers?: ("linux-builder" | "windows-runner")[]; ai?: Parameters<typeof buildApp>[0] extends infer D ? D extends { ai?: infer A } ? A : never : never } = {}): Promise<Stack> {
  const dataDir = mkdtempSync(join(tmpdir(), "mcs-test-"));
  const config = loadConfig({ dataDir, logLevel: "silent", webDir: null, workerToken: "test-token-" + Math.random().toString(36).slice(2) });
  const app = await buildApp({ config, ai: opts.ai });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const procs: ChildProcess[] = [];
  for (const w of opts.workers ?? []) {
    const p = spawn(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, `workers/${w}/src/index.ts`)], {
      env: { ...process.env, MCS_API_URL: base, MCS_WORKER_TOKEN: config.workerToken, MCS_WORKER_ID: `${w}-test`, MCS_CONCURRENCY: "3", MCS_WORK_ROOT: join(dataDir, "work-" + w) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.stderr?.on("data", (d) => process.env.MCS_TEST_VERBOSE && process.stderr.write(`[${w}] ${d}`));
    procs.push(p);
  }
  if (procs.length) {
    // Wait until workers have registered their capabilities.
    for (let i = 0; i < 100; i++) {
      const caps = (await (await fetch(base + "/api/capabilities")).json()) as { workers: string[] };
      if (opts.workers!.every((w) => caps.workers.some((c) => (w === "linux-builder" ? c.startsWith("build:") : c === "run:wine")))) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return {
    base,
    token: config.workerToken,
    app,
    async close() {
      for (const p of procs) p.kill("SIGTERM");
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Minimal cookie-keeping client that behaves like the web app. */
export class Client {
  cookie = "";
  constructor(public base: string) {}
  async req<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const isBuf = body instanceof Uint8Array || body instanceof FormData;
    const res = await fetch(this.base + path, {
      method,
      headers: { "x-mcs-client": "web", ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined && !isBuf ? { "content-type": "application/json" } : {}), ...extra },
      body: body === undefined ? undefined : isBuf ? (body as BodyInit) : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!;
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* binary */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }
  async raw(path: string) {
    return fetch(this.base + path, { headers: { cookie: this.cookie } });
  }
  async register(email = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`) {
    const r = await this.req("POST", "/api/auth/register", { email, name: "Test", password: "password-123" });
    if (r.status !== 200) throw new Error("register failed " + JSON.stringify(r.body));
    return r.body.user;
  }
  async project(files: { path: string; content: string }[], config?: Record<string, unknown>) {
    const r = await this.req("POST", "/api/projects", { name: "t", files: files.map((f) => ({ ...f, encoding: "utf8" })) });
    if (config) await this.req("PATCH", `/api/projects/${r.body.project.id}`, { config });
    return r.body.project.id as string;
  }
  async build(projectId: string, config?: Record<string, unknown>) {
    const start = await this.req("POST", `/api/projects/${projectId}/builds`, { config });
    if (start.status !== 200) return { status: "rejected", result: start.body } as any;
    let job = start.body.job;
    let log = "";
    let offset = 0;
    const deadline = Date.now() + 300_000;
    while (!["succeeded", "failed", "cancelled"].includes(job.status) && Date.now() < deadline) {
      job = (await this.req("GET", `/api/jobs/${job.id}/wait?logOffset=${offset}&wait=5000`)).body.job;
      log += job.log;
      offset = job.logLength;
    }
    return { ...job, log };
  }
  /** Start a run and collect output; `input` is sent once the program reports running. */
  async run(projectId: string, artifactId: string, backend: string, opts: { input?: string; display?: boolean; onFrame?: (ws: WebSocket, n: number) => void; timeoutMs?: number } = {}) {
    const r = await this.req("POST", `/api/projects/${projectId}/runs`, { artifactId, backend, display: !!opts.display });
    if (r.status !== 200) return { error: r.body, out: "", status: "rejected", exitCode: null, frames: 0 };
    const ws = new WebSocket(this.base.replace("http", "ws") + `/api/runs/${r.body.job.id}/ws`, { headers: { cookie: this.cookie } });
    return await new Promise<{ out: string; status: string; exitCode: number | null; frames: number; jobId: string }>((resolve) => {
      let out = "";
      let frames = 0;
      let sent = false;
      const t = setTimeout(() => {
        ws.send(JSON.stringify({ type: "stop" }));
      }, opts.timeoutMs ?? 60000);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "stdout" || m.type === "stderr") out += m.data;
        if (m.type === "frame") opts.onFrame?.(ws, ++frames);
        if (m.type === "status" && m.status === "running" && opts.input !== undefined && !sent) {
          sent = true;
          ws.send(JSON.stringify({ type: "stdin", data: opts.input }));
        }
        if (m.type === "status" && ["exited", "stopped", "error"].includes(m.status)) {
          clearTimeout(t);
          ws.close();
          resolve({ out, status: m.status, exitCode: m.exitCode ?? null, frames, jobId: r.body.job.id });
        }
      });
    });
  }
}

export const hasCmd = (c: string) => spawnSync("sh", ["-c", `command -v ${c}`]).status === 0;
