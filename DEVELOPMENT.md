# Development

## Requirements

* Node.js ≥ 22.12 (uses the built-in `node:sqlite`), pnpm 10 (`corepack enable`).
* Linux worker tools (Ubuntu/Debian):
  ```bash
  sudo apt-get install -y bubblewrap g++ clang cmake make clang-format \
    g++-mingw-w64-x86-64-posix gcc-mingw-w64-x86-64-posix binutils-mingw-w64-x86-64
  # Windows Runner (optional):
  sudo dpkg --add-architecture i386 && sudo apt-get update
  sudo apt-get install -y wine wine64 xvfb xdotool imagemagick
  # Ubuntu 24.04 only — allow unprivileged user namespaces for bubblewrap:
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
  ```
* macOS/Windows developers: run the workers in Docker (see DEPLOYMENT.md) or a Linux VM. For UI
  work only, the API runs anywhere; builds simply stay queued until a worker connects.

## Run everything locally

```bash
pnpm install

# 1) API (serves the built web app when MCS_WEB_DIR is set)
pnpm --filter @mcs/web build
MCS_WEB_DIR=$PWD/apps/web/out pnpm --filter @mcs/api start        # http://localhost:4000

# 2) Workers (the dev worker token is generated in apps/api/.data/worker-token)
export MCS_WORKER_TOKEN=$(cat apps/api/.data/worker-token) MCS_API_URL=http://127.0.0.1:4000
pnpm --filter @mcs/linux-builder start
pnpm --filter @mcs/windows-runner start
```

Hot-reload UI development: `pnpm --filter @mcs/api dev` (port 4000) and
`pnpm --filter @mcs/web dev` (port 3000, proxies `/api/*` to 4000). For the run console in dev mode
set `NEXT_PUBLIC_API_WS_ORIGIN=ws://localhost:4000` because Next's dev proxy does not forward
websockets.

## Environment variables

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `PORT`, `HOST` | api | `4000`, `0.0.0.0` | listen address |
| `MCS_DATA_DIR` | api | `./.data` | SQLite DB + artifacts |
| `MCS_WEB_DIR` | api | — | static web export to serve |
| `MCS_WORKER_TOKEN` | api, workers | dev: generated | shared worker secret (**required in production**) |
| `MCS_COOKIE_SECURE` | api | `0` | set `1` behind HTTPS |
| `MCS_ALLOW_REGISTRATION` | api | `1` | `0` closes sign-ups |
| `MCS_TEMPLATES_DIR` | api | `templates/` | project templates |
| `ANTHROPIC_API_KEY` | api | — | enables the AI assistant |
| `MCS_AI_PROVIDER`, `MCS_AI_MODEL` | api | `anthropic`, `claude-opus-5-5` | assistant provider/model |
| `MCS_API_URL` | workers | `http://127.0.0.1:4000` | API base URL |
| `MCS_WORKER_ID`, `MCS_CONCURRENCY` | workers | host-pid, `2` | identity / parallel jobs |
| `MCS_CAPABILITIES` | workers | auto-detected | override advertised capabilities |
| `MCS_WORK_ROOT` | workers | `$TMPDIR/mcs-work` | per-job sandbox directories |
| `MCS_SANDBOX=unsafe-none` | workers | — | **local experiments only**: disables isolation |

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test:unit
pnpm test:security       # needs bubblewrap + gcc
pnpm test:integration    # needs the worker toolchains; Wine/Xvfb tests skip when absent
# E2E against a running stack (API on :4100 with MCS_WEB_DIR + both workers):
MCS_BASE_URL=http://127.0.0.1:4100 node tests/e2e/run-e2e.mjs
```

Integration tests start the real API in-process on a random port and spawn real worker processes;
nothing is mocked.

## Adding a template

Create `templates/<id>/template.json` (`nameAr`, `descriptionAr`, `level`, `config`) and the
project files next to it. It appears in the "new project" dialog after an API restart.

## Code layout conventions

* TypeScript everywhere, ESM, packages import each other's `src/*.ts` directly (no build step).
* UI copy is Arabic; code, logs for developers and identifiers are English.
* Use logical CSS properties (`ms-`, `pe-`, `start`) — the UI is RTL, code areas are LTR.
