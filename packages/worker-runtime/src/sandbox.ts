import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

export interface SandboxLimits {
  timeoutMs: number;
  /** RLIMIT_AS in bytes; null disables (Wine reserves large address ranges). */
  memoryBytes: number | null;
  cpuSeconds: number;
  maxProcesses: number;
  maxFileBytes: number;
  maxOutputBytes: number;
}

export interface SandboxBind {
  host: string;
  sandbox: string;
  readOnly?: boolean;
}

export interface SandboxOptions {
  /** Host directory mounted read-write at /work. The only writable persistent path. */
  workDir: string;
  argv: string[];
  /** Working directory relative to /work. */
  cwd?: string;
  env?: Record<string, string>;
  limits: SandboxLimits;
  stdin?: boolean;
  binds?: SandboxBind[];
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SandboxResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
}

export interface SandboxHandle {
  child: ChildProcess;
  done: Promise<SandboxResult>;
  write(data: string): void;
  closeStdin(): void;
  kill(): void;
}

export type SandboxMode = "bwrap" | "unsafe-none";

/** Minimal /etc entries a toolchain or Wine needs — never the whole /etc (shadow, keys...). */
const ETC_ALLOW = [
  "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/alternatives", "/etc/localtime",
  "/etc/fonts", "/etc/nsswitch.conf", "/etc/os-release", "/etc/lsb-release", "/etc/debian_version", "/etc/wine",
];

export function detectSandboxMode(): SandboxMode {
  if (process.env.MCS_SANDBOX === "unsafe-none") return "unsafe-none";
  // Probe with the same mounts real jobs use (/proc, /dev, /tmp) so a half-working setup — e.g. Docker
  // masking /proc — is reported at start-up instead of failing every build.
  const r = spawnSync(
    "bwrap",
    ["--die-with-parent", "--unshare-all", "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "/usr/bin/true"],
    { timeout: 5000 },
  );
  if (r.status !== 0) {
    throw new Error(
      "bubblewrap (bwrap) is required to isolate user code and is not working on this host. " +
        "Install it (apt install bubblewrap) and allow unprivileged user namespaces " +
        "(sysctl kernel.apparmor_restrict_unprivileged_userns=0 on Ubuntu 24.04). In Docker run the worker with " +
        "security_opt seccomp=unconfined, apparmor=unconfined and systempaths=unconfined. " +
        "For local experiments only you may set MCS_SANDBOX=unsafe-none. stderr: " + r.stderr?.toString(),
    );
  }
  return "bwrap";
}

export function buildBwrapArgs(opts: SandboxOptions): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all", // user, pid, net, ipc, uts, cgroup namespaces: no network inside
    "--cap-drop", "ALL",
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/sbin", "/sbin",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--dir", "/etc",
  ];
  for (const e of ETC_ALLOW) if (existsSync(e)) args.push("--ro-bind", e, e);
  args.push("--bind", opts.workDir, "/work");
  for (const b of opts.binds ?? []) args.push(b.readOnly ? "--ro-bind" : "--bind", b.host, b.sandbox);
  args.push(
    "--chdir", "/work/" + (opts.cwd && opts.cwd !== "." ? opts.cwd : ""),
    "--uid", "1000",
    "--gid", "1000",
    "--hostname", "sandbox",
    "--clearenv",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "HOME", "/tmp",
    // Note: do not set TMPDIR — Wine 9 aborts with "free(): invalid pointer" when it is set.
    "--setenv", "LANG", "C.UTF-8",
  );
  for (const [k, v] of Object.entries(opts.env ?? {})) args.push("--setenv", k, v);
  return args;
}

export function prlimitArgs(l: SandboxLimits): string[] {
  const a = ["prlimit", `--cpu=${l.cpuSeconds}`, `--nproc=${l.maxProcesses}`, `--fsize=${l.maxFileBytes}`, "--nofile=512", "--core=0"];
  if (l.memoryBytes) a.push(`--as=${l.memoryBytes}`);
  a.push("--");
  return a;
}

/**
 * Run argv inside a bubblewrap sandbox with rlimits and a wall-clock timeout.
 * No shell is involved; argv is passed verbatim.
 */
export function runSandboxed(opts: SandboxOptions, mode: SandboxMode): SandboxHandle {
  const start = Date.now();
  const inner = [...prlimitArgs(opts.limits), ...opts.argv];
  const child =
    mode === "bwrap"
      ? spawn("bwrap", [...buildBwrapArgs(opts), "--", ...inner], { stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"], detached: true })
      : spawn(inner[0]!, inner.slice(1), {
          cwd: opts.workDir + "/" + (opts.cwd ?? ""),
          env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8", ...(opts.env ?? {}) },
          stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
          detached: true,
        });

  let outBytes = 0;
  let truncated = false;
  let timedOut = false;
  const handle = (cb?: (s: string) => void) => (buf: Buffer) => {
    if (truncated) return;
    outBytes += buf.byteLength;
    if (outBytes > opts.limits.maxOutputBytes) {
      truncated = true;
      cb?.("\n[تم إيقاف المخرجات: تجاوزت الحد المسموح]\n");
      killTree();
      return;
    }
    cb?.(buf.toString("utf8"));
  };
  child.stdout?.on("data", handle(opts.onStdout));
  child.stderr?.on("data", handle(opts.onStderr));

  const killTree = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, opts.limits.timeoutMs);

  const done = new Promise<SandboxResult>((resolve) => {
    child.on("error", (err) => {
      opts.onStderr?.(`[sandbox] ${err.message}\n`);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, timedOut, outputTruncated: truncated, durationMs: Date.now() - start });
    });
  });

  return {
    child,
    done,
    write: (d) => {
      if (child.stdin && !child.stdin.destroyed) child.stdin.write(d);
    },
    closeStdin: () => child.stdin?.end(),
    kill: killTree,
  };
}
