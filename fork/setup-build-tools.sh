#!/usr/bin/env bash
set -euo pipefail
# Only writes into a new caller-selected directory. No latest URLs or global installs.
root="${1:?new build-tools directory required}"
mkdir -m 700 "$root"
curl -q -fsSL --proto '=https' --tlsv1.2 --max-time 300 \
  https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz -o "$root/node.tar.xz"
curl -q -fsSL --proto '=https' --tlsv1.2 --max-time 300 \
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-baseline.zip -o "$root/bun.zip"
(cd "$root" && sha256sum -c <<'SUMS'
9aa8e9d2298ab68c600bd6fb86a6c13bce11a4eca1ba9b39d79fa021755d7c37  node.tar.xz
c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f  bun.zip
SUMS
)
tar -xJf "$root/node.tar.xz" -C "$root"
unzip -q "$root/bun.zip" -d "$root"
