import type { RunClientMessage, RunServerMessage } from "@mcs/shared";
import { wsUrl } from "./api";

type Listener = (m: RunServerMessage) => void;

/** Browser side of a run session: one websocket to the API relay. */
export class RunSession {
  private ws: WebSocket;
  private listeners = new Set<Listener>();
  private backlog: RunServerMessage[] = [];
  status: Extract<RunServerMessage, { type: "status" }>["status"] = "starting";
  inputMode: "tty" | "line" = "tty";
  closed = false;

  constructor(public readonly jobId: string, public readonly display: boolean, public readonly backend: string) {
    this.ws = new WebSocket(wsUrl(`/api/runs/${jobId}/ws`));
    this.ws.onmessage = (ev) => {
      let m: RunServerMessage;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "status") {
        this.status = m.status;
        if (m.inputMode) this.inputMode = m.inputMode;
      }
      if (m.type !== "frame") {
        this.backlog.push(m);
        if (this.backlog.length > 5000) this.backlog.shift();
      }
      for (const l of this.listeners) l(m);
    };
    this.ws.onclose = () => {
      this.closed = true;
      if (this.status === "starting" || this.status === "running") {
        const m: RunServerMessage = { type: "status", status: "error", message: "انقطع الاتصال بجلسة التشغيل" };
        this.status = "error";
        for (const l of this.listeners) l(m);
      }
    };
  }

  /** Subscribe; replays everything received so far (except frames). */
  subscribe(l: Listener): () => void {
    for (const m of this.backlog) l(m);
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  send(m: RunClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  stop() {
    this.send({ type: "stop" });
  }

  close() {
    this.ws.close();
  }

  get active() {
    return this.status === "starting" || this.status === "running";
  }
}
