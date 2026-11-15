#!/usr/bin/env bash
# Starts the whole platform (API + web on port 4000, build worker, Windows runner) in the background.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
DATA=${MCS_DATA_DIR:-$HOME/.mcs-data}
LOGS=/tmp
mkdir -p "$DATA"

# Ubuntu hosts may restrict unprivileged user namespaces (needed by bubblewrap). Best effort.
if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sudo sysctl -qw kernel.apparmor_restrict_unprivileged_userns=0 2>/dev/null || true
fi
if ! bwrap --die-with-parent --unshare-all --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 /usr/bin/true 2>/dev/null; then
  echo "✖ bubblewrap cannot create a sandbox here — builds/runs stay disabled for safety." >&2
fi

# A fresh random worker token per start; never stored in the repository.
TOKEN_FILE="$DATA/worker-token"
[ -s "$TOKEN_FILE" ] || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
export MCS_WORKER_TOKEN=$(cat "$TOKEN_FILE")
export MCS_DATA_DIR="$DATA" MCS_WEB_DIR="$ROOT/apps/web/out" PORT=4000 LOG_LEVEL=warn
export NODE_OPTIONS="--disable-warning=ExperimentalWarning"
[ -n "${CODESPACES:-}" ] && export MCS_COOKIE_SECURE=1

pkill -f "apps/api/src/index.ts" 2>/dev/null; pkill -f "linux-builder/src/index.ts" 2>/dev/null; pkill -f "windows-runner/src/index.ts" 2>/dev/null
sleep 1
[ -d "$ROOT/apps/web/out" ] || pnpm --filter @mcs/web build

nohup "$ROOT/node_modules/.bin/tsx" apps/api/src/index.ts > "$LOGS/mcs-api.log" 2>&1 &
for i in $(seq 1 50); do curl -fs http://127.0.0.1:4000/api/health >/dev/null && break; sleep 0.3; done

export MCS_API_URL=http://127.0.0.1:4000
nohup "$ROOT/node_modules/.bin/tsx" workers/linux-builder/src/index.ts > "$LOGS/mcs-linux-builder.log" 2>&1 &
nohup "$ROOT/node_modules/.bin/tsx" workers/windows-runner/src/index.ts > "$LOGS/mcs-windows-runner.log" 2>&1 &
sleep 4

# Make the site reachable without a GitHub login (best effort; the owner can always open it).
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null; then
  gh codespace ports visibility 4000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
fi

echo "Workers: $(curl -fs http://127.0.0.1:4000/api/capabilities | sed -E 's/.*"workers":\[([^]]*)\].*/\1/')"
if [ -n "${CODESPACE_NAME:-}" ]; then
  echo "✔ Muhammad C++ Studio: https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/run/"
else
  echo "✔ Muhammad C++ Studio: http://localhost:4000/run/"
fi
echo "  Logs: $LOGS/mcs-*.log"
