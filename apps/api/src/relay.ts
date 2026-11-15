import type { WebSocket } from "ws";
import type { RunClientMessage, RunServerMessage } from "@mcs/shared";

interface Session {
  worker: WebSocket | null;
  clients: Set<WebSocket>;
  /** Recent console output replayed to clients that (re)connect. */
  backlog: RunServerMessage[];
  backlogBytes: number;
  lastStatus: RunServerMessage | null;
  lastFrame: RunServerMessage | null;
  idleTimer: NodeJS.Timeout | null;
}

/** Stop a program when no browser has been watching it for this long. */
export const IDLE_STOP_MS = 60_000;

const MAX_BACKLOG = 256 * 1024;

/**
 * Relays run-session traffic between the browser and the execution worker.
 * The API never executes user programs; it only forwards bytes.
 */
export class RunRelay {
  private sessions = new Map<string, Session>();

  private get(jobId: string): Session {
    let s = this.sessions.get(jobId);
    if (!s) {
      s = { worker: null, clients: new Set(), backlog: [], backlogBytes: 0, lastStatus: null, lastFrame: null, idleTimer: null };
      this.sessions.set(jobId, s);
    }
    return s;
  }

  attachWorker(jobId: string, ws: WebSocket, onFinished: () => void) {
    const s = this.get(jobId);
    s.worker?.close();
    s.worker = ws;
    this.armIdle(jobId, s);
    ws.on("message", (raw) => {
      let msg: RunServerMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "stdout" || msg.type === "stderr") {
        s.backlog.push(msg);
        s.backlogBytes += msg.data.length;
        while (s.backlogBytes > MAX_BACKLOG && s.backlog.length > 1) {
          const old = s.backlog.shift()!;
          if (old.type === "stdout" || old.type === "stderr") s.backlogBytes -= old.data.length;
        }
      } else if (msg.type === "status") s.lastStatus = msg;
      else if (msg.type === "frame") s.lastFrame = msg;
      const data = JSON.stringify(msg);
      for (const c of s.clients) if (c.readyState === c.OPEN) c.send(data);
    });
    ws.on("close", () => {
      if (s.worker === ws) s.worker = null;
      onFinished();
      setTimeout(() => this.cleanup(jobId), 60_000).unref();
    });
  }

  attachClient(jobId: string, ws: WebSocket) {
    const s = this.get(jobId);
    s.clients.add(ws);
    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.idleTimer = null;
    if (s.lastStatus) ws.send(JSON.stringify(s.lastStatus));
    for (const m of s.backlog) ws.send(JSON.stringify(m));
    if (s.lastFrame) ws.send(JSON.stringify(s.lastFrame));
    ws.on("message", (raw) => {
      let msg: RunClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!isValidClientMessage(msg)) return;
      if (s.worker && s.worker.readyState === s.worker.OPEN) s.worker.send(JSON.stringify(msg));
    });
    ws.on("close", () => {
      s.clients.delete(ws);
      this.armIdle(jobId, s);
    });
  }

  private armIdle(jobId: string, s: Session) {
    if (s.clients.size > 0 || s.idleTimer) return;
    s.idleTimer = setTimeout(() => {
      s.idleTimer = null;
      if (s.clients.size === 0) this.stop(jobId);
    }, IDLE_STOP_MS);
    s.idleTimer.unref();
  }

  stop(jobId: string) {
    const s = this.sessions.get(jobId);
    if (s?.worker && s.worker.readyState === s.worker.OPEN) s.worker.send(JSON.stringify({ type: "stop" } satisfies RunClientMessage));
  }

  private cleanup(jobId: string) {
    const s = this.sessions.get(jobId);
    if (!s || s.worker) return;
    for (const c of s.clients) c.close();
    this.sessions.delete(jobId);
  }
}

export function isValidClientMessage(m: unknown): m is RunClientMessage {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case "stdin":
      return typeof o.data === "string" && o.data.length <= 64 * 1024;
    case "stop":
    case "screenshot":
      return true;
    case "mouse":
      return typeof o.x === "number" && typeof o.y === "number" && [0, 1, 2, 3].includes(o.button as number) && ["move", "down", "up", "click"].includes(o.action as string);
    case "key":
      return typeof o.key === "string" && o.key.length <= 32 && ["down", "up", "press"].includes(o.action as string);
    default:
      return false;
  }
}
