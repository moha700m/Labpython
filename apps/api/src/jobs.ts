import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { TOOLCHAINS } from "@mcs/compiler";
import { LIMITS, describeFormatAr, detectBinaryFormat, type BuildConfig, type BuildResult, type JobStatus, type JobSummary, type JobType, type RunRequest } from "@mcs/shared";
import type { DB } from "./db.ts";
import { now } from "./db.ts";
import type { ArtifactStorage } from "./storage.ts";

interface JobRow {
  id: string;
  project_id: string;
  user_id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  phase: string;
  config_json: string;
  run_json: string | null;
  input_artifact_id: string | null;
  snapshot_json: string | null;
  required_capability: string;
  worker_id: string | null;
  log: string;
  result_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
}

export interface ArtifactRow {
  id: string;
  job_id: string;
  user_id: string;
  project_id: string;
  file_name: string;
  size: number;
  sha256: string;
  format: string;
  storage_key: string;
  created_at: string;
}

export class JobError extends Error {
  constructor(public status: number, public code: string, public messageAr: string) {
    super(code);
  }
}

/** Capability strings a worker advertises: "build:<compiler>" and "run:<backend>". */
export const buildCapability = (c: BuildConfig) => `build:${c.compiler}`;
export const runCapability = (r: RunRequest) => `run:${r.backend}`;

const LEASE_MS = 90_000;

export class Jobs {
  readonly events = new EventEmitter();
  constructor(private db: DB, private storage: ArtifactStorage) {
    this.events.setMaxListeners(1000);
  }

  private toSummary(r: JobRow): JobSummary {
    return {
      id: r.id,
      projectId: r.project_id,
      type: r.type,
      status: r.status,
      progress: r.progress,
      phase: r.phase,
      config: JSON.parse(r.config_json),
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      result: r.result_json ? JSON.parse(r.result_json) : null,
    };
  }

  getOwned(userId: string, jobId: string) {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(jobId, userId) as JobRow | undefined;
    if (!r) throw new JobError(404, "not_found", "المهمة غير موجودة");
    return r;
  }

  summary(userId: string, jobId: string, logOffset = 0) {
    const r = this.getOwned(userId, jobId);
    return { ...this.toSummary(r), log: r.log.slice(logOffset), logLength: r.log.length, run: r.run_json ? JSON.parse(r.run_json) : null };
  }

  listForProject(userId: string, projectId: string, limit = 20) {
    const rows = this.db
      .prepare("SELECT * FROM jobs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, projectId, limit) as unknown as JobRow[];
    return rows.map((r) => this.toSummary(r));
  }

  createBuild(userId: string, projectId: string, config: BuildConfig, snapshot: unknown[]) {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO jobs (id, project_id, user_id, type, status, phase, config_json, snapshot_json, required_capability, created_at)
         VALUES (?, ?, ?, 'build', 'queued', 'queued', ?, ?, ?, ?)`,
      )
      .run(id, projectId, userId, JSON.stringify(config), JSON.stringify(snapshot), buildCapability(config), now());
    this.events.emit("queued");
    return this.summary(userId, id);
  }

  createRun(userId: string, projectId: string, artifactId: string, run: RunRequest) {
    const art = this.artifactOwned(userId, artifactId);
    if (art.project_id !== projectId) throw new JobError(400, "artifact_mismatch", "الملف الناتج لا يتبع هذا المشروع");
    const isPe = art.format === "pe32+" || art.format === "pe32";
    const isElf = art.format === "elf64" || art.format === "elf32";
    if (run.backend === "native" && !isElf) throw new JobError(400, "backend_mismatch", "التشغيل الأصلي يدعم ملفات Linux فقط. استخدم Windows Runner لملفات EXE.");
    if ((run.backend === "wine" || run.backend === "windows") && !isPe) throw new JobError(400, "backend_mismatch", "Windows Runner يشغّل ملفات EXE فقط.");
    const active = this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND type = 'run' AND status IN ('queued','running')").get(userId) as { n: number };
    if (active.n >= 2) throw new JobError(429, "too_many_runs", "لديك جلسات تشغيل نشطة كثيرة. أوقف إحداها أولاً.");
    const id = randomUUID();
    const job = this.db.prepare("SELECT config_json FROM jobs WHERE id = ?").get(art.job_id) as { config_json: string } | undefined;
    this.db
      .prepare(
        `INSERT INTO jobs (id, project_id, user_id, type, status, phase, config_json, run_json, input_artifact_id, required_capability, created_at)
         VALUES (?, ?, ?, 'run', 'queued', 'queued', ?, ?, ?, ?, ?)`,
      )
      .run(id, projectId, userId, job?.config_json ?? "{}", JSON.stringify(run), artifactId, runCapability(run), now());
    this.events.emit("queued");
    return this.summary(userId, id);
  }

  cancel(userId: string, jobId: string) {
    const r = this.getOwned(userId, jobId);
    if (r.status === "queued") {
      this.finish(jobId, "cancelled", null);
    } else if (r.status === "running") {
      this.events.emit(`cancel:${jobId}`);
      this.db.prepare("UPDATE jobs SET phase = 'cancelling' WHERE id = ?").run(jobId);
    }
    return this.summary(userId, jobId);
  }

  isCancelRequested(jobId: string) {
    const r = this.db.prepare("SELECT phase, status FROM jobs WHERE id = ?").get(jobId) as { phase: string; status: string } | undefined;
    return !r || r.phase === "cancelling" || r.status === "cancelled";
  }

  // ---- worker side -------------------------------------------------------

  registerWorker(workerId: string, capabilities: string[]) {
    this.db
      .prepare("INSERT INTO workers (id, capabilities_json, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET capabilities_json = excluded.capabilities_json, last_seen_at = excluded.last_seen_at")
      .run(workerId, JSON.stringify(capabilities), now());
  }

  /** Capabilities of workers seen in the last 2 minutes — what the UI may offer as working. */
  liveCapabilities(): string[] {
    const since = new Date(Date.now() - 120_000).toISOString();
    const rows = this.db.prepare("SELECT capabilities_json FROM workers WHERE last_seen_at > ?").all(since) as { capabilities_json: string }[];
    return [...new Set(rows.flatMap((r) => JSON.parse(r.capabilities_json) as string[]))].sort();
  }

  claim(workerId: string, capabilities: string[]) {
    this.registerWorker(workerId, capabilities);
    this.reapStale();
    if (capabilities.length === 0) return null;
    const placeholders = capabilities.map(() => "?").join(",");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = this.db
        .prepare(`SELECT * FROM jobs WHERE status = 'queued' AND required_capability IN (${placeholders}) ORDER BY created_at LIMIT 1`)
        .get(...capabilities) as JobRow | undefined;
      if (!r) {
        this.db.exec("COMMIT");
        return null;
      }
      const t = now();
      this.db.prepare("UPDATE jobs SET status = 'running', phase = 'preparing', worker_id = ?, started_at = ?, heartbeat_at = ? WHERE id = ?").run(workerId, t, t, r.id);
      this.db.exec("COMMIT");
      this.events.emit(`update:${r.id}`);
      let artifact: { id: string; fileName: string; format: string; sha256: string } | null = null;
      if (r.input_artifact_id) {
        const a = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(r.input_artifact_id) as unknown as ArtifactRow;
        artifact = { id: a.id, fileName: a.file_name, format: a.format, sha256: a.sha256 };
      }
      return {
        id: r.id,
        type: r.type,
        config: JSON.parse(r.config_json) as BuildConfig,
        files: r.snapshot_json ? JSON.parse(r.snapshot_json) : [],
        run: r.run_json ? (JSON.parse(r.run_json) as RunRequest) : null,
        artifact,
        limits: LIMITS,
      };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private assertWorkerOwns(workerId: string, jobId: string) {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!r || r.worker_id !== workerId) throw new JobError(404, "not_found", "job not assigned to this worker");
    return r;
  }

  appendEvents(workerId: string, jobId: string, events: ({ type: "log"; data: string } | { type: "progress"; progress: number; phase: string })[]) {
    const r = this.assertWorkerOwns(workerId, jobId);
    let log = r.log;
    let progress = r.progress;
    let phase = r.phase;
    for (const e of events) {
      if (e.type === "log" && log.length < LIMITS.logMaxBytes) {
        log += e.data.slice(0, LIMITS.logMaxBytes - log.length);
        if (log.length >= LIMITS.logMaxBytes) log += "\n[السجل تجاوز الحد الأقصى وتم اقتطاعه]\n";
      } else if (e.type === "progress") {
        progress = Math.max(0, Math.min(1, e.progress));
        if (phase !== "cancelling") phase = e.phase.slice(0, 40);
      }
    }
    this.db.prepare("UPDATE jobs SET log = ?, progress = ?, phase = ?, heartbeat_at = ? WHERE id = ?").run(log, progress, phase, now(), jobId);
    this.events.emit(`update:${jobId}`);
    return { cancel: phase === "cancelling" };
  }

  async storeArtifact(workerId: string, jobId: string, fileName: string, data: Buffer) {
    const r = this.assertWorkerOwns(workerId, jobId);
    if (r.type !== "build") throw new JobError(400, "not_build", "only build jobs produce artifacts");
    const format = detectBinaryFormat(new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, 4096)));
    const config = JSON.parse(r.config_json) as BuildConfig;
    // Never accept an artifact whose bytes contradict the requested target.
    const wantWin = TOOLCHAINS[config.compiler].target === "windows-exe";
    if (config.output !== "static-lib") {
      if (wantWin && format !== "pe32+" && format !== "pe32") throw new JobError(422, "format_mismatch", "artifact is not a PE file");
      if (!wantWin && format !== "elf64" && format !== "elf32") throw new JobError(422, "format_mismatch", "artifact is not an ELF file");
    }
    const id = randomUUID();
    const sha256 = createHash("sha256").update(data).digest("hex");
    await this.storage.put(id, data);
    const safeName = fileName.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "artifact";
    this.db
      .prepare("INSERT INTO artifacts (id, job_id, user_id, project_id, file_name, size, sha256, format, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, jobId, r.user_id, r.project_id, safeName, data.byteLength, sha256, format, id, now());
    return { id, fileName: safeName, size: data.byteLength, sha256, format, description: describeFormatAr(format) };
  }

  complete(workerId: string, jobId: string, result: BuildResult | { status: "succeeded" | "failed"; summaryAr: string; exitCode: number | null; durationMs: number }) {
    const r = this.assertWorkerOwns(workerId, jobId);
    if (r.status !== "running") return;
    const cancelled = r.phase === "cancelling";
    // The artifact reference must come from storeArtifact for this job, never from the worker's claim.
    if ("artifact" in result && result.artifact) {
      const a = this.db.prepare("SELECT * FROM artifacts WHERE id = ? AND job_id = ?").get(result.artifact.id, jobId) as ArtifactRow | undefined;
      if (!a) delete (result as BuildResult).artifact;
      else (result as BuildResult).artifact = { id: a.id, fileName: a.file_name, size: a.size, sha256: a.sha256, format: a.format as never, description: describeFormatAr(a.format as never) };
    }
    this.finish(jobId, cancelled ? "cancelled" : result.status, result);
  }

  private finish(jobId: string, status: JobStatus, result: unknown) {
    this.db
      .prepare("UPDATE jobs SET status = ?, phase = ?, progress = CASE WHEN ? = 'succeeded' THEN 1 ELSE progress END, result_json = ?, finished_at = ?, snapshot_json = NULL WHERE id = ?")
      .run(status, status === "succeeded" ? "done" : status, status, result ? JSON.stringify(result) : null, now(), jobId);
    this.events.emit(`update:${jobId}`);
    this.events.emit(`finished:${jobId}`);
  }

  /** Jobs whose worker stopped heart-beating are failed so users are not left waiting forever. */
  reapStale() {
    const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
    const stale = this.db.prepare("SELECT id FROM jobs WHERE status = 'running' AND heartbeat_at < ?").all(cutoff) as { id: string }[];
    for (const s of stale) {
      this.db.prepare("UPDATE jobs SET log = log || ? WHERE id = ?").run("\n[انقطع الاتصال بالعامل (worker) — تم إيقاف المهمة]\n", s.id);
      this.finish(s.id, "failed", { status: "failed", summaryAr: "انقطع الاتصال بالعامل", exitCode: null, durationMs: 0, diagnostics: [] });
    }
  }

  heartbeat(workerId: string, jobId: string) {
    this.assertWorkerOwns(workerId, jobId);
    this.db.prepare("UPDATE jobs SET heartbeat_at = ? WHERE id = ?").run(now(), jobId);
  }

  workerJob(workerId: string, jobId: string) {
    return this.assertWorkerOwns(workerId, jobId);
  }

  // ---- artifacts ---------------------------------------------------------

  artifactOwned(userId: string, artifactId: string) {
    const a = this.db.prepare("SELECT * FROM artifacts WHERE id = ? AND user_id = ?").get(artifactId, userId) as ArtifactRow | undefined;
    if (!a) throw new JobError(404, "not_found", "الملف غير موجود");
    return a;
  }

  artifactForWorker(workerId: string, artifactId: string) {
    const a = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(artifactId) as ArtifactRow | undefined;
    if (!a) throw new JobError(404, "not_found", "not found");
    // A worker may only fetch the artifact of a run job assigned to it.
    const j = this.db.prepare("SELECT 1 FROM jobs WHERE input_artifact_id = ? AND worker_id = ? AND status = 'running'").get(artifactId, workerId);
    if (!j) throw new JobError(403, "forbidden", "artifact not linked to a job of this worker");
    return a;
  }

  listArtifacts(userId: string, projectId: string) {
    return this.db
      .prepare("SELECT id, job_id, file_name, size, sha256, format, created_at FROM artifacts WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(userId, projectId);
  }
}
