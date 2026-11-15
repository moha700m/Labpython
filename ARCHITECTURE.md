# Architecture

```
 Browser (desktop / iPhone Safari)
   │  HTTPS (same origin)            WebSocket /api/runs/:id/ws
   ▼                                   ▼
 ┌──────────────────────────── apps/api (Fastify, Node 22) ─────────────────────────────┐
 │ static web export · auth (scrypt + HttpOnly session) · projects/files (SQLite)       │
 │ job queue (SQLite, capability-routed) · artifact storage · run relay · security log  │
 │ AI assistant (proposals only)                                                         │
 └──────────────▲───────────────────────────────▲───────────────────────────────────────┘
                │ pull: POST /api/worker/claim   │ WS /api/worker/runs/:id/ws
                │ (Bearer worker token)          │
     ┌──────────┴──────────┐          ┌──────────┴───────────┐
     │ workers/linux-builder│          │ workers/windows-runner│
     │ build:gcc|clang|mingw│          │ run:wine, run:display │
     │ run:native           │          │ Xvfb + xdotool + import│
     └──────────┬──────────┘          └──────────┬───────────┘
                └──── bubblewrap sandbox per step/session (no network, rlimits, timeouts)
```

## Principles

1. **The API never executes user code.** It stores files and relays bytes. All compilation and
   execution happens on workers, inside a fresh sandbox per job.
2. **Workers pull work.** Workers connect out to the API with a shared token and advertise
   capabilities (`build:mingw-gcc`, `run:wine`, …). The UI shows a feature as available only when
   a live worker advertises it (`GET /api/capabilities`).
3. **Formats come from bytes, not names.** `detectBinaryFormat` reads the PE/ELF header. The API
   refuses to store an artifact whose bytes contradict the requested target, so an ELF can never
   be labelled `.exe`.
4. **Nothing is shown as working unless it is.** Debugger, profiler, Git and MSVC are not
   implemented; the UI disables them and says so.

## Data model (SQLite, `node:sqlite`)

`users`, `sessions` (sha256 of token), `projects` (+ build config JSON), `files` (path, content,
encoding), `jobs` (type build|run, status, progress, phase, log, result, required capability,
worker, heartbeat), `artifacts` (sha256, detected format, storage key), `security_events`,
`workers` (capabilities, last seen).

SQLite fits a single API instance. For several API instances move to Postgres (same schema) and
replace the in-process `EventEmitter`/rate limiter with Redis — see DEPLOYMENT.md.

## Build pipeline

1. `POST /api/projects/:id/builds` validates the config (zod), runs `planBuild` once to reject bad
   flags/targets early, snapshots all files into the job, and queues it under `build:<compiler>`.
2. A worker claims it, writes files into a temp dir (paths re-validated), and executes the plan:
   argv arrays only (no shell), one compile step per translation unit then link (or
   `cmake` configure+build with a generated MinGW toolchain file, or `make CXX=…`).
3. Logs/progress stream in batches (`/events`), heartbeats keep the lease; stale jobs are failed.
4. Output is parsed into diagnostics (GCC/Clang/MSVC/ld formats) with Arabic explanations; the
   artifact is uploaded, re-checked by the API and stored under a server-generated key.

## Run pipeline

1. `POST /api/projects/:id/runs` (explicit user action, confirmed in the UI) picks a backend from
   the artifact's real format: ELF → `run:native`, PE → `run:wine` (+ `run:display` for GUI).
2. The worker downloads the artifact (sha256 verified), runs it in the sandbox:
   * native: under a pseudo-terminal (`script`) for real interactive behaviour;
   * wine: plain pipes (Wine's tty console mangles UTF-8), fresh Wine prefix per session created by
     `wineboot --init`, optional private Xvfb display. Frames are captured with ImageMagick
     `import` (JPEG, only when changed) and input injected with `xdotool`.
3. The API relays messages between browser and worker, replays recent output on reconnect, and
   stops sessions nobody watches for 60 s. Session directories (incl. Wine prefix) are deleted.

## Frontend

Next.js App Router compiled to a static export (`output: "export"`) served by the API, so cookies
and websockets share one origin. Monaco is self-hosted (copied to `/monaco/vs`), no runtime CDN.
The IDE mounts exactly one layout (desktop or mobile) to avoid duplicate Monaco models. The
console is HTML (not a canvas terminal) so Arabic output is shaped and ordered correctly.

## Why these choices

* **bubblewrap** instead of Docker-per-job: millisecond start-up, unprivileged, works inside a
  container; production adds cgroup limits at the container level (compose `pids_limit`,
  `mem_limit`, `cpus`).
* **MinGW-w64 cross compiler**: real PE output from Linux workers, reproducible, tested in CI.
  MSVC requires Windows hosts (documented in `workers/windows-builder`).
* **Wine + Xvfb + JPEG frames over the existing websocket** instead of WebRTC: no TURN/STUN
  infrastructure, works through any HTTPS proxy and on iOS Safari. WebRTC remains an option for
  a native Windows runner where higher frame rates matter.
