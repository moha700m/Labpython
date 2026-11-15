# Changelog

## 0.4.0 — 2026-11-15 — Windows app

### Added
- `apps/desktop`: Muhammad C++ Studio as a real Windows program (`MuhammadCppStudio-Setup.exe`, Inno Setup,
  per-user install, no admin, no Docker). One Node process serves the UI on 127.0.0.1 and runs an
  in-process worker that builds with the bundled native **w64devkit (MinGW-w64 GCC)** and **CMake**, and
  runs programs **natively on Windows** — GUI programs open as real windows on the desktop.
- Win32 launcher (`apps/desktop/launcher/launcher.cpp`, built with the bundled g++): starts the server
  hidden, waits for `/api/health`, opens the browser, small Arabic control window; a Job Object stops
  the server and everything it started when the window is closed; a second launch just opens the browser.
- Sandbox mode `host` (desktop: timeouts, output caps, process-tree kill via `taskkill /T`), native MinGW
  toolchain in the planner (`planBuild(..., { native: true })`, `MinGW Makefiles` for CMake).
- `.github/workflows/desktop.yml`: on `windows-latest` fetches Node 22 + w64devkit + CMake, builds the
  launcher, tests the packaged layout on real Windows (`tests/e2e/smoke.mjs` with `MCS_SMOKE_BACKEND=windows`:
  console EXE with input, CMake project, GUI window started and stopped), builds Setup.exe and publishes
  it as the latest GitHub release on `main`.

## 0.3.1 — 2026-11-15

### Added
- Run the whole studio on your own computer: `Start-Studio.bat` / `Stop-Studio.bat` (Windows, Docker
  Desktop) and `start-studio.sh` (macOS/Linux). README download + double-click instructions.
- `tests/e2e/smoke.mjs` and a CI job that builds and starts the compose stack and checks that
  all workers are online and a real EXE builds and runs.

### Fixed
- Builds failed inside Docker ("bwrap: Can't mount proc"): workers now use `systempaths=unconfined`,
  and the start-up sandbox probe mounts `/proc` so such setups are reported immediately.
- Container commands run the `tsx` shim directly (no package-manager download at start-up).
- Codespaces: link file + services kept alive (see 0.3.0 follow-up commit).

## 0.3.0 — 2026-11-15 — «ذكي، بسيط، سعودي»

Informed by similar projects (Compiler Explorer and OnlineGDB share links without sign-in; Coddy's
instant Arabic playground). What none of them offer — an Arabic-first platform that outputs a real
Windows EXE — stays the core.

### Added
- One-tap guest sessions (`POST /api/auth/guest`): the `/run/` page and shared links work without an account.
- Smart auto-fix (`packages/compiler/src/autofix.ts`, `POST /api/projects/:id/autofix`): missing headers
  (+ `using namespace std;`), missing semicolons (both GCC location styles), `void main`, GUI/console
  entry-point mismatch. Preview first, apply only on the user's tap, then rebuild — in `/run/` and the IDE.
- Share links (`/share/?id=…`): immutable public snapshot of the code; "run it now" forks into the
  visitor's own (guest) account and builds + runs it.
- Saudi examples on `/run/`: VAT 15% calculator, zakat calculator, Gregorian→Hijri (tabular),
  guess-the-number, electronic tasbeeh (Win32 GUI).
- Saudi identity: green/gold theme (dark + light), friendly Saudi-dialect copy on the main flows.
- Tests: autofix unit tests, guest/share security tests, autofix + examples integration tests,
  3 new phone E2E steps (no account → example → input; broken file → auto-fix → run; share → visitor runs).

## 0.2.0 — 2026-11-15

### Added
- `/run/` page: drop a `.cpp`, several files or a `.zip` → project → real Windows EXE → automatic run
  in the Windows Runner (interactive console, or live window for WinMain programs) → download.
- Uploaded sources are inspected: `WinMain` → Windows GUI subsystem, `wWinMain` → plus `-municode`.
- GitHub Codespaces support (`.devcontainer/`): the whole platform starts on GitHub with one click.
- MIT license.
- Tests: `inferConfig` unit tests; two new E2E steps for `/run/` (12 E2E steps total).

## 0.1.0 — 2026-11-15 (unreleased, development branch)

First working version, built from an empty repository.

### Added
- Monorepo (pnpm): `apps/api`, `apps/web`, `packages/{shared,compiler,localization,worker-runtime}`,
  `workers/{linux-builder,windows-runner,windows-builder}`, templates, tests, Docker, CI.
- Arabic RTL web IDE (Next.js static export, Tailwind, self-hosted Monaco): dashboard, templates,
  ZIP/folder/file upload, file tree, tabs, autosave, formatting, C++ completions and quick fixes,
  beginner/pro mode, dark/light themes, mobile layout.
- Build system: GCC, Clang, MinGW-w64 (real PE32+ EXE), C++17–C++26 (per compiler support),
  single/multi-file, CMake (with generated MinGW toolchain), Makefile, static/shared libraries,
  Win32 resources; live logs, progress, Arabic diagnostics, artifact download with SHA-256.
- Execution: interactive console runs (native Linux via PTY; EXE via Wine), GUI live preview with
  mouse/keyboard input and screenshots, idle auto-stop, full clean-up.
- Learning mode: 6 Arabic lessons with exercises checked by real build + run.
- AI assistant (Claude via official SDK, server-side key) with diff review and explicit approval.
- Security: bubblewrap sandbox (no network, rlimits, timeouts), path/ZIP hardening, flag
  allow-list, per-user isolation, CSRF header, rate limits, security event log.
- Tests: 50 unit, 27 security, 20 integration (97 total), 10-step Playwright E2E (desktop + iPhone viewport emulation).
