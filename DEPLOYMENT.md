# Deployment

No hosting provider is configured for this repository yet. Everything below is ready to run on a
Linux host you control; CI deploys only when you add a deployment hook secret.

## Single host with Docker Compose

```bash
export MCS_WORKER_TOKEN=$(openssl rand -hex 32)       # keep it out of git
export MCS_COOKIE_SECURE=1                            # when served over HTTPS
export ANTHROPIC_API_KEY=...                          # optional: enables the assistant
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
```

Put a TLS reverse proxy (Caddy, nginx, Traefik) in front of port 4000. It must forward
WebSocket upgrades for `/api/runs/*` and `/api/worker/runs/*`.

Services:

* `api` — web + API, non-root, data in the `studio-data` volume (SQLite + artifacts). Back it up.
* `linux-builder` — GCC/Clang/MinGW builds and native runs.
* `windows-runner` — Wine-based execution with live preview.

Workers need user namespaces for bubblewrap inside the container, hence
`security_opt: seccomp=unconfined, apparmor=unconfined`. Compensating controls: `cap_drop: ALL`,
non-root user, `pids_limit`, `mem_limit`, `cpus`, and a dedicated network. For stronger isolation
run workers on separate VMs (or gVisor/Kata/Firecracker runtimes) away from the API host.

## Scaling

* Add more worker containers/VMs — they pull jobs, so no load balancer is needed for them.
* One API instance with SQLite handles a classroom-sized load. For several API instances: move to
  Postgres, put artifacts on S3-compatible storage (implement `ArtifactStorage` in
  `apps/api/src/storage.ts`), and replace the in-process event bus/rate limiter with Redis.

## Native Windows workers (MSVC builds, real Windows execution)

Not implemented yet — see `workers/windows-builder/README.md` and
`workers/windows-runner/README.md` for the required infrastructure and the protocol they must
speak. The UI will offer MSVC / native Windows execution automatically once such a worker
advertises `build:msvc` / `run:windows`.

## CI/CD

`.github/workflows/ci.yml` runs lint, typecheck, unit, security, integration, Playwright E2E and
Docker image builds on every push/PR. On `main`, the `deploy` job calls `secrets.DEPLOY_HOOK_URL`
(e.g. a Render/Coolify/Portainer deploy hook) **only if that secret exists**; otherwise it skips.
Configure it under *Settings → Secrets and variables → Actions* and protect the `production`
environment as needed.

## Operational checklist

- [ ] `MCS_WORKER_TOKEN` set from a secret store, rotated on suspicion.
- [ ] HTTPS + `MCS_COOKIE_SECURE=1`.
- [ ] Workers run as non-root (Dockerfiles do) so process limits apply.
- [ ] Data volume backed up; disk alerts (Wine prefixes are ~700 MB per active session).
- [ ] `security_events` table reviewed / shipped to your log system.
- [ ] `MCS_ALLOW_REGISTRATION=0` if the instance is private.
