import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { RunClientMessage, RunServerMessage } from "@mcs/shared";
import type { DisplaySession } from "@mcs/worker-runtime";

const WIDTH = 1024;
const HEIGHT = 768;
let nextDisplay = 90 + Math.floor(Math.random() * 100);

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 3000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

const KEYSYMS: Record<string, string> = {
  Enter: "Return", Backspace: "BackSpace", Tab: "Tab", Escape: "Escape", Delete: "Delete", " ": "space",
  ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Home: "Home", End: "End",
  PageUp: "Prior", PageDown: "Next", Shift: "Shift_L", Control: "Control_L", Alt: "Alt_L",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6", F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};

/**
 * A private Xvfb display per run session. Xvfb runs on the worker (trusted side);
 * only its unix socket is bind-mounted into the sandbox, so the program can draw
 * on its own display and nothing else. Frames are captured with ImageMagick
 * `import` and streamed as JPEG; input is injected with xdotool.
 */
export async function createXvfbDisplay(): Promise<DisplaySession> {
  const num = nextDisplay++;
  if (nextDisplay > 400) nextDisplay = 90;
  const display = `:${num}`;
  const env = { ...process.env, DISPLAY: display };
  const xvfb: ChildProcess = spawn("Xvfb", [display, "-screen", "0", `${WIDTH}x${HEIGHT}x24`, "-nolisten", "tcp", "-nolisten", "inet6"], { stdio: "ignore" });
  const socket = `/tmp/.X11-unix/X${num}`;
  for (let i = 0; i < 50 && !existsSync(socket); i++) await new Promise((r) => setTimeout(r, 100));
  if (!existsSync(socket)) {
    xvfb.kill("SIGKILL");
    throw new Error("Xvfb failed to start");
  }
  let timer: NodeJS.Timeout | null = null;
  let lastHash = "";
  let stopped = false;
  const xdo = (args: string[]) => run("xdotool", args, env).catch(() => undefined);

  return {
    env: { DISPLAY: display },
    binds: [{ host: socket, sandbox: socket }],
    async start(send: (m: RunServerMessage) => void) {
      const tick = async () => {
        if (stopped) return;
        try {
          const jpg = await run("import", ["-display", display, "-window", "root", "-quality", "60", "jpeg:-"], env, 4000);
          const h = createHash("sha1").update(jpg).digest("hex");
          if (h !== lastHash) {
            lastHash = h;
            send({ type: "frame", mime: "image/jpeg", data: jpg.toString("base64"), width: WIDTH, height: HEIGHT });
          }
        } catch {
          /* display not ready yet */
        }
        if (!stopped) timer = setTimeout(tick, 200);
      };
      timer = setTimeout(tick, 300);
    },
    input(m: RunClientMessage) {
      if (m.type === "mouse") {
        const x = String(Math.max(0, Math.min(WIDTH - 1, Math.round(m.x))));
        const y = String(Math.max(0, Math.min(HEIGHT - 1, Math.round(m.y))));
        const btn = String(m.button === 0 ? 1 : m.button);
        if (m.action === "move") void xdo(["mousemove", x, y]);
        else if (m.action === "click") void xdo(["mousemove", x, y, "click", btn]);
        else void xdo(["mousemove", x, y, m.action === "down" ? "mousedown" : "mouseup", btn]);
      } else if (m.type === "key") {
        const sym = KEYSYMS[m.key];
        if (sym) void xdo([m.action === "down" ? "keydown" : m.action === "up" ? "keyup" : "key", sym]);
        else if ([...m.key].length === 1 && m.action !== "up") void xdo(["type", "--", m.key]);
      }
    },
    async screenshot() {
      try {
        return (await run("import", ["-display", display, "-window", "root", "png:-"], env, 5000)).toString("base64");
      } catch {
        return null;
      }
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      xvfb.kill("SIGTERM");
      setTimeout(() => xvfb.kill("SIGKILL"), 2000).unref();
    },
  };
}
