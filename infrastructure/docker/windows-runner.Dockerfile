# Windows Execution Worker (Wine backend): runs PE files inside bubblewrap with a fresh
# Wine prefix per session and a private Xvfb display streamed to the browser.
FROM node:22-bookworm-slim
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
      wine wine64 xvfb xdotool imagemagick bubblewrap util-linux fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @mcs/windows-runner...
RUN useradd --system --uid 10003 --create-home runner
USER runner
ENV MCS_WORK_ROOT=/home/runner/work
CMD ["workers/windows-runner/node_modules/.bin/tsx", "workers/windows-runner/src/index.ts"]
