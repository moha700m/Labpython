# Linux Build Worker: GCC, Clang, MinGW-w64 (→ real Windows PE), CMake, Make, bubblewrap.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ clang cmake make bubblewrap util-linux \
      g++-mingw-w64-x86-64-posix gcc-mingw-w64-x86-64-posix binutils-mingw-w64-x86-64 \
    && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @mcs/linux-builder...
# Non-root so RLIMIT_NPROC applies to sandboxed user code.
RUN useradd --system --uid 10002 --create-home builder
USER builder
ENV MCS_WORK_ROOT=/home/builder/work
CMD ["workers/linux-builder/node_modules/.bin/tsx", "workers/linux-builder/src/index.ts"]
