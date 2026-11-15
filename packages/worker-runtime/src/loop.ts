import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { WorkerApi } from "./api.ts";

export function hasCommand(cmd: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
}

export interface WorkerLoopOptions<J> {
  name: string;
  capabilities: string[];
  concurrency: number;
  handle: (job: J, api: WorkerApi) => Promise<void>;
}

export function workerApiFromEnv(name: string): WorkerApi {
  const baseUrl = process.env.MCS_API_URL ?? "http://127.0.0.1:4000";
  const token = process.env.MCS_WORKER_TOKEN ?? "";
  if (!token) throw new Error("MCS_WORKER_TOKEN is required");
  const workerId = process.env.MCS_WORKER_ID ?? `${name}-${hostname()}-${process.pid}`.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
  return new WorkerApi({ baseUrl, token, workerId });
}

/** Poll-claim-execute loop with bounded concurrency and back-off when idle or offline. */
export async function runWorkerLoop<J extends { id: string }>(api: WorkerApi, opts: WorkerLoopOptions<J>): Promise<never> {
  let active = 0;
  let idleDelay = 500;
  const cleaned = cleanStaleWorkDirs();
  console.log(`[${opts.name}] started with capabilities: ${opts.capabilities.join(", ")}${cleaned ? ` (removed ${cleaned} stale job dirs)` : ""}`);
  for (;;) {
    if (active >= opts.concurrency) {
      await sleep(200);
      continue;
    }
    try {
      const res = await api.claim<J>(opts.capabilities);
      if (!res) {
        await sleep(idleDelay);
        idleDelay = Math.min(idleDelay * 1.5, 2000);
        continue;
      }
      idleDelay = 300;
      active++;
      void opts
        .handle(res.job, api)
        .catch((e) => console.error(`[${opts.name}] job ${res.job.id} crashed`, e))
        .finally(() => active--);
    } catch (e) {
      console.error(`[${opts.name}] claim failed: ${(e as Error).message}`);
      await sleep(3000);
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Root for per-job sandbox directories. Everything under it is disposable. */
export function workRoot(): string {
  const root = process.env.MCS_WORK_ROOT ?? join(tmpdir(), "mcs-work");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

/**
 * Remove job directories left behind by a crashed/killed worker. Only entries older
 * than the longest possible job are touched, so concurrent workers are unaffected.
 */
export function cleanStaleWorkDirs(maxAgeMs = 15 * 60_000): number {
  const root = workRoot();
  let removed = 0;
  for (const name of readdirSync(root)) {
    if (!/^mcs-(build|run)-/.test(name)) continue;
    const full = join(root, name);
    try {
      if (Date.now() - statSync(full).mtimeMs > maxAgeMs) {
        rmSync(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* raced with another cleaner */
    }
  }
  return removed;
}
