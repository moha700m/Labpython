# Security

Muhammad C++ Studio compiles and runs code that users upload. The design assumes that code is
hostile.

## Isolation layers

| Layer | Control | Verified by |
|---|---|---|
| Process placement | API never compiles/executes user code; only workers do | architecture, `tests/integration` |
| Sandbox | bubblewrap: new user/pid/net/ipc/uts/cgroup namespaces, `--cap-drop ALL`, read-only `/usr`, minimal `/etc` allow-list (no `/etc/shadow`, keys…), private `/tmp`, only `/work` writable, cleared environment, `--die-with-parent` | `tests/security/sandbox.test.ts` |
| Network | `--unshare-all` ⇒ no network inside builds or runs | `has no network access` test |
| Resources | `prlimit`: CPU seconds, address space, file size, processes, open files, no core dumps; wall-clock timeout kills the whole session; output byte cap | CPU/timeout/memory/fsize/flood/fork-bomb tests |
| Container | compose: `cap_drop: ALL`, `pids_limit`, `mem_limit`, `cpus`, separate `workers` network, non-root users | `infrastructure/docker` |
| Clean-up | per-job temp dir removed after every build/run (incl. Wine prefix); stale dirs swept at worker start; idle run sessions stopped after 60 s | code + manual verification |

**Known limitation:** `RLIMIT_NPROC` is only enforced for non-root users. Run workers as a
dedicated non-root user (the Dockerfiles do) so the process limit applies; with root the pid
namespace + session kill still contain and clean up fork bombs (tested), but do not bound them.

## Uploads

* Every path goes through `normalizeProjectPath`: rejects `..`, absolute paths, drive letters, UNC,
  NUL/control characters, Windows device names, trailing dots/spaces, excessive depth/length.
* Allow-list of file types (sources, headers, CMake/Make, text, `.rc`, icons/images). Executables
  and scripts are refused.
* ZIP import is in-memory only: entry count, total size, per-file size and compression-ratio limits;
  symlink entries rejected (central directory scanned); duplicate/case-colliding paths rejected.
* Workers re-validate every path before writing it (defence in depth).

## Build configuration

Compiler/linker flags pass an allow-list; `-fplugin`, `-wrapper`, `-B`, `-specs`, `@file`, `-o`,
`--sysroot`, absolute or `..` include/library paths, linker `--wrap/-rpath/--plugin` are rejected
(and logged).

## Web

* Sessions: 32-byte random tokens, stored as SHA-256, `HttpOnly; SameSite=Lax` cookie (`Secure`
  with `MCS_COOKIE_SECURE=1`), 14-day expiry. Passwords: scrypt (N=16384, r=8, p=1).
* CSRF: mutating `/api/*` requests must carry `x-mcs-client: web` (not settable by cross-site forms).
* Per-user ownership checks on every project/file/job/artifact/websocket; foreign IDs return 404.
* Rate limits on login/registration, builds and assistant calls. Security headers on all responses.
* Worker endpoints require `Authorization: Bearer $MCS_WORKER_TOKEN` (constant-time compare). A
  worker can only touch jobs assigned to it and artifacts of its running jobs.

## Audit log

`security_events` records failed/successful logins, rate limiting, denied access, rejected paths and
ZIPs, rejected flags, worker auth failures, run starts and AI proposals.

## Secrets

No secrets in the repository. `MCS_WORKER_TOKEN` and `ANTHROPIC_API_KEY` come from the environment
(CI: GitHub secrets). The UI never asks users for API keys. In development the API generates a
worker token into the git-ignored data directory.

## AI assistant

Returns proposals only. The browser shows a diff per file and writes nothing without the user's
explicit approval; proposed paths are normalised and anything outside the project is dropped.

## Reporting

Please report vulnerabilities privately to the repository owner rather than in public issues.

## Third-party components

| Component | Use | License |
|---|---|---|
| Next.js, React | web UI | MIT |
| Monaco Editor | code editor (self-hosted) | MIT |
| Tailwind CSS | styling | MIT |
| lucide-react | icons | ISC |
| Fastify + plugins | API | MIT |
| zod | validation | MIT |
| fflate | ZIP | MIT |
| ws | websockets | MIT |
| @anthropic-ai/sdk | AI provider | MIT |
| IBM Plex Sans Arabic, JetBrains Mono | fonts (Google Fonts, self-hosted at build) | OFL |
| bubblewrap, util-linux (`prlimit`, `script`) | sandbox (system packages, not vendored) | LGPL/GPL |
| MinGW-w64, GCC, Clang | compilers (system packages) | GPL with runtime exception / Apache-2.0 LLVM |
| Wine, Xvfb, xdotool, ImageMagick | Windows runner (system packages) | LGPL / MIT / BSD / Apache-2.0 |

System tools are installed from distribution packages and invoked as separate programs; none are
copied into this repository.
