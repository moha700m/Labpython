#!/usr/bin/env bash
# One-time setup of a Codespace / dev container: toolchains, sandbox, Wine, dependencies, web build.
set -euo pipefail
cd "$(dirname "$0")/.."

export DEBIAN_FRONTEND=noninteractive
sudo dpkg --add-architecture i386
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends \
  bubblewrap util-linux g++ clang cmake make clang-format \
  g++-mingw-w64-x86-64-posix gcc-mingw-w64-x86-64-posix binutils-mingw-w64-x86-64 \
  wine wine64 xvfb xdotool imagemagick fonts-dejavu-core >/dev/null

corepack enable >/dev/null 2>&1 || sudo corepack enable
pnpm install --frozen-lockfile
pnpm --filter @mcs/web build
echo "✔ setup complete"
bash .devcontainer/write-link.sh "" ""
