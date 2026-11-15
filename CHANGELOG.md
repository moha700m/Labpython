# Changelog

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
