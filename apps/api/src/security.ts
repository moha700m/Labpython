import type { DB } from "./db.ts";
import { now } from "./db.ts";

export type SecurityEventKind =
  | "auth.login_failed"
  | "auth.login"
  | "auth.register"
  | "auth.rate_limited"
  | "access.denied"
  | "upload.rejected_path"
  | "upload.rejected_zip"
  | "build.flag_rejected"
  | "worker.auth_failed"
  | "run.started"
  | "run.stopped"
  | "ai.proposal";

export class SecurityLog {
  constructor(private db: DB) {}
  record(kind: SecurityEventKind, detail: Record<string, unknown>, ctx: { userId?: string | null; ip?: string | null } = {}) {
    this.db
      .prepare("INSERT INTO security_events (at, user_id, ip, kind, detail) VALUES (?, ?, ?, ?, ?)")
      .run(now(), ctx.userId ?? null, ctx.ip ?? null, kind, JSON.stringify(detail).slice(0, 4000));
  }
  recent(limit = 100) {
    return this.db.prepare("SELECT * FROM security_events ORDER BY id DESC LIMIT ?").all(limit);
  }
}

/** Fixed-window in-memory rate limiter. One process; for multi-instance use a shared store. */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private limit: number, private windowMs: number) {}
  take(key: string): boolean {
    const t = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.reset < t) {
      this.hits.set(key, { count: 1, reset: t + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(t);
      return true;
    }
    cur.count++;
    return cur.count <= this.limit;
  }
  private sweep(t: number) {
    for (const [k, v] of this.hits) if (v.reset < t) this.hits.delete(k);
  }
}
