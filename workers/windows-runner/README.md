# Windows Execution Worker

Runs Windows executables built by the platform and streams them to the browser.

## Implemented backend: `wine` (Linux host)

* Capability `run:wine` (+ `run:display` when Xvfb, xdotool and ImageMagick are installed).
* Each session: new temp directory, artifact downloaded and sha256-checked, **fresh Wine prefix**
  (`wineboot --init`) inside a bubblewrap sandbox without network, then the program.
* Console programs use pipes (UTF-8 safe); GUI programs get a private `Xvfb` display whose unix
  socket is the only display bind-mounted into the sandbox. Frames: JPEG via `import`, sent only
  when changed (~5 fps). Input: `xdotool` mouse/keyboard. Screenshots: PNG on demand.
* Stop: user request, 5-minute wall clock, CPU limit, or 60 s without any viewer. The session
  directory (including the prefix) is deleted afterwards.

Wine is a compatibility layer, not Windows. Most console programs and plain Win32 GUI programs
work; DirectX-heavy, driver, .NET or installer-type programs may not.

```bash
MCS_API_URL=http://127.0.0.1:4000 MCS_WORKER_TOKEN=... pnpm --filter @mcs/windows-runner start
```

## Planned backend: `windows` (native Windows host) — not implemented

Requirements for a production-grade native runner:

1. A Windows Server host with Hyper-V; one disposable VM (or Windows Sandbox / Hyper-V isolated
   container) per session, created from a golden image and destroyed afterwards.
2. An agent inside the VM speaking the same protocol as `@mcs/worker-runtime`
   (`/api/worker/claim` with capability `run:windows`, artifact download, run websocket).
3. Screen streaming from the VM desktop (WebRTC via a TURN server, or the existing JPEG-over-WS
   protocol), input injection with `SendInput`.
4. No network from the VM except to the API relay; Job Objects for CPU/memory limits.

Until such a worker is connected, the API never advertises `run:windows` and the UI does not offer it.
