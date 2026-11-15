#!/usr/bin/env bash
# Muhammad C++ Studio — run the whole studio on this computer (macOS / Linux) with Docker.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f infrastructure/docker/docker-compose.yml --env-file .env"
PORT="${MCS_PORT:-4000}"

if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  echo "✖ Docker غير مثبت أو غير شغّال. ثبّت Docker Desktop من https://www.docker.com/products/docker-desktop/ وشغّله، ثم أعد المحاولة."
  exit 1
fi

if [ "${1:-}" = "stop" ]; then $COMPOSE down; echo "✔ تم إيقاف الاستديو."; exit 0; fi

# A private random worker token, created once and kept only on this computer.
if [ ! -s .env ]; then
  printf 'MCS_WORKER_TOKEN=%s\nMCS_PORT=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" "$PORT" > .env
fi

echo "⏳ تجهيز الاستديو… أول مرة تاخذ 5–15 دقيقة (تنزيل المترجمات وWine)، بعدها ثواني."
$COMPOSE up -d --build

echo "⏳ انتظار تشغيل الموقع…"
for _ in $(seq 1 120); do
  curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
URL="http://localhost:$PORT/run/"
echo "✔ الاستديو شغّال: $URL"
(command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") || true
echo "للإيقاف: ./start-studio.sh stop"
