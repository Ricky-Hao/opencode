# Unofficial OpenCode fork

This maintenance branch of **Ricky-Hao/opencode** targets upstream **v2.0.19**,
commit `1fd016ef32286de9489b7b24f1029f52c49a27b3`, deliberately independent
of upstream's current default branch. Its own version is **v2.0.19-ricky.1**.
It is not an official upstream release. The MIT [LICENSE](../LICENSE) is
unchanged and is included in every distribution archive.

## Scope

The sole product change is `catalog-readiness.patch` (SHA256
`8930ee92a7d7d732bb2175466740ac82a0b604c22ce88a9de99403438f306400`),
applied verbatim to `packages/cli/src/acp/service.ts`. Its original four
offline regressions live in `packages/cli/test/acp/network-readiness.test.ts`.
ACP waits for an explicit `OPENCODE_ACP_REQUIRED_MODEL=provider/model`, checks
optional `OPENCODE_ACP_REQUIRED_VARIANT`, and bounds catalog reads using
`OPENCODE_ACP_CATALOG_TIMEOUT_MS` (default 30000, integer 100–120000).
Missing targets fail closed; this is a deliberate ACP compatibility change.
There are no bundled provider identities, credentials or model defaults.

Initial target: **Linux x64 glibc baseline** only (no AVX2 requirement).
The CLI build omits the web UI. Other operating systems/architectures/libcs
and end-to-end provider/MCP behavior are not validated by this recipe.

## Local build

Requires Linux, Python 3.11+, bash, git, curl, tar, xz and unzip. Choose new
writable paths outside any active toolchain:

```sh
bash fork/setup-build-tools.sh /absolute/new/build-tools
python3 fork/build.py --output /absolute/new/build-output \
  --node /absolute/new/build-tools/node-v22.22.0-linux-x64/bin/node \
  --bun /absolute/new/build-tools/bun-linux-x64-baseline/bun
```

Node 22.22.0, Bun 1.4.2 and the upstream `bun.lock` SHA256 are enforced.
The script installs only the CLI's frozen dependencies with scripts disabled,
runs the actual readiness test in `packages/cli`, compiles the baseline target
with `--skip-install --skip-web-ui`, and checks the compiled `--version`.
`assets/` contains a tar.gz with `opencode`, `LICENSE`, `metadata.json`, plus
standalone metadata and `SHA256SUMS`. Metadata records source commit, actual
tag (null for local builds), dirty state, source-content digest, upstream,
tools, target and binary checksum. Local dirty artifacts are not releasable.
Build output is a new directory each time; source dependencies stay in this repo.

This is a reproducible **recipe**, not a promise of byte-identical artifacts:
upstream build-time/network inputs, platform tooling and Bun compilation may
vary. Promote the hash of the actual reviewed release asset, never a local
trial hash. Nothing here implies a release already exists.

## CI and release maintenance

All 27 inherited workflows (deploy, publish, schedules and issue/PR management
included) are archived byte-for-byte in `.github/upstream-workflows/` and are
inactive on this maintenance branch. Only `fork.yml` remains active here.
This does not modify the remote default branch or disable workflows stored there;
default-branch schedules/issue automation remain subject to that branch's settings.
Branch pushes and maintenance PRs only test/build/upload CI artifacts.

Only a pushed own tag matching `vX.Y.Z-ricky.N` **and** `fork/release.json`
can publish, only to `Ricky-Hao/opencode`. The publish job alone has write
permission; it requires clean tagged provenance and refuses existing releases.
Assets are prereleases and never marked latest. No npm, container, web, or
deployment publishing is enabled. Action commits were verified against the
public `actions/*` repositories' v4.3.1/v4.6.2/v4.3.0 tags.

To update: review a specific upstream commit/tag and its build scripts, review
all newly inherited automation before integrating it, rebase/reapply the exact
patch (review any required changes separately), and rerun readiness tests and
the full local build. Update reviewed hashes, version and upstream metadata
together. Review the source diff and archive contents before committing.
After a maintainer separately authorizes publication, commit/tag the reviewed
tree and push an own-version tag. Verify downloaded assets against SHA256SUMS
before promoting consumers' required tag/asset/hash inputs. Never overwrite
an existing release; increment the own version instead.
