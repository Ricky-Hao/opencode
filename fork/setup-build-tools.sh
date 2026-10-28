#!/usr/bin/env bash
set -euo pipefail
# Only writes into a new caller-selected directory. No latest URLs or global installs.
root="${1:?new build-tools directory required}"
mkdir -m 700 "$root"
curl -q -fsSL --proto '=https' --tlsv1.2 --max-time 300 \
  https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz -o "$root/node.tar.xz"
curl -q -fsSL --proto '=https' --tlsv1.2 --max-time 300 \
  https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64-baseline.zip -o "$root/bun.zip"
(cd "$root" && sha256sum -c <<'SUMS'
1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce  node.tar.xz
e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76  bun.zip
SUMS
)
tar -xJf "$root/node.tar.xz" -C "$root"
unzip -q "$root/bun.zip" -d "$root"
