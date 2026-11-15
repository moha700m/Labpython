import WebSocket from "ws";

export interface WorkerApiOptions {
  baseUrl: string;
  token: string;
  workerId: string;
}

/** HTTP client for the worker side of the job protocol. */
export class WorkerApi {
  constructor(private opts: WorkerApiOptions) {}

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.opts.token}`, "x-worker-id": this.opts.workerId, ...extra };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.opts.baseUrl + path, {
      method,
      headers: this.headers(body !== undefined ? { "content-type": "application/json" } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null as T;
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  claim<T>(capabilities: string[]) {
    return this.json<{ job: T } | null>("POST", "/api/worker/claim", { capabilities });
  }

  events(jobId: string, events: unknown[]) {
    return this.json<{ cancel: boolean }>("POST", `/api/worker/jobs/${jobId}/events`, { events });
  }

  complete(jobId: string, result: unknown) {
    return this.json<{ ok: boolean }>("POST", `/api/worker/jobs/${jobId}/complete`, result);
  }

  async uploadArtifact(jobId: string, name: string, data: Buffer) {
    const res = await fetch(`${this.opts.baseUrl}/api/worker/jobs/${jobId}/artifact?name=${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: this.headers({ "content-type": "application/octet-stream" }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`artifact upload -> ${res.status} ${await res.text()}`);
    return ((await res.json()) as { artifact: { id: string; fileName: string; size: number; sha256: string; format: string; description: string } }).artifact;
  }

  async downloadArtifact(artifactId: string): Promise<Buffer> {
    const res = await fetch(`${this.opts.baseUrl}/api/worker/artifacts/${artifactId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`artifact download -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  openRunSocket(jobId: string): Promise<WebSocket> {
    const url = this.opts.baseUrl.replace(/^http/, "ws") + `/api/worker/runs/${jobId}/ws`;
    const ws = new WebSocket(url, { headers: this.headers() });
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }
}

/**
 * Buffers log output and progress and flushes them to the API at most every
 * `intervalMs`, so a chatty compiler cannot flood the API with requests.
 */
export class EventBatcher {
  private queue: unknown[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();
  public cancelRequested = false;

  constructor(private api: WorkerApi, private jobId: string, private intervalMs = 300) {}

  log(data: string) {
    if (!data) return;
    this.queue.push({ type: "log", data });
    this.schedule();
  }

  progress(progress: number, phase: string) {
    this.queue.push({ type: "progress", progress, phase });
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.intervalMs);
  }

  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (this.queue.length === 0) return;
      // Merge consecutive log chunks to keep requests small.
      const batch = this.queue.splice(0, this.queue.length);
      const merged: unknown[] = [];
      for (const e of batch as ({ type: "log"; data: string } | { type: "progress" })[]) {
        const last = merged[merged.length - 1] as { type: string; data?: string } | undefined;
        if (e.type === "log" && last?.type === "log" && (last.data!.length + e.data.length) < 200_000) last.data += e.data;
        else merged.push({ ...e });
      }
      try {
        const r = await this.api.events(this.jobId, merged);
        if (r?.cancel) this.cancelRequested = true;
      } catch (err) {
        console.error("[worker] failed to send events", err);
      }
    });
    return this.flushing;
  }

  async close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}
