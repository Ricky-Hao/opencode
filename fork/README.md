# 非官方 OpenCode 维护 fork

`Ricky-Hao/opencode` 的维护分支为 `ricky-opencode2`。本版完整合并上游
**v2.2.0**（`1097e2668b1e08ad63bdf0b1c4860b9bc01e420c`），保留维护历史。
自有候选版本为 **v2.2.0-ricky.1**，本阶段不创建 tag 或 Release。
它不是上游官方发行版。上游 GitHub `latest` 可能指向仍维护的 v1，不能据此选择 v2。
MIT [LICENSE](../LICENSE) 保持不变，并随每个发行包提供。

## 行为与范围

`catalog-readiness.patch` 是相对该上游版本的 readiness 生产代码差异。
补丁移植到新的 Effect catalog 服务，并通过 CLI 的 `Env` 读取配置。
补丁与 lockfile 的审核 SHA256 记录在 [release.json](release.json)。

ACP 必须显式设置 `OPENCODE_ACP_REQUIRED_MODEL=provider/model`。
`OPENCODE_ACP_REQUIRED_VARIANT` 可选。`OPENCODE_ACP_CATALOG_TIMEOUT_MS`
默认 `30000`，只接受 `100..120000` 范围内的整数毫秒数。
目标模型尚未出现时，ACP 继续等待，不回退到 builtin 或服务器默认模型。
缺少目标、无效配置、目标 variant 不可用或超时均失败。
超时会中断读取；失败的首次加载会从同目录缓存中移除，允许重试。
这些是本 fork 有意保留的 ACP 兼容性变化。源码不内置 provider 身份、凭据或目标模型默认值。

取消逻辑沿用上游 #52503（`2c3392241204cdbf0a38320b2d6f48fb82e9912d`）
及后续修复，使用 interruptible Effect fibers 和 scoped subscriptions。
新增 barrier 回归覆盖：提交已返回、当前输入尚未 delivered、事件 consumer 已等待，
随后取消且服务端不再产生事件。prompt 必须有界返回 `cancelled`。
测试同时检查订阅清理、同 session 后续可用，以及不删除其他排队输入。
不修改 inbox 的 admission、steer、delivery 或取消契约。

发行目标仅为 **Linux x64 glibc baseline**，不要求 AVX2，且不打包 web UI。
本配方不验收其他系统、架构、libc 或付费 provider/MCP 端到端行为。

## 本地构建

需要 Linux、Python 3.11+、bash、git、curl、tar、xz 和 unzip。
工具目录和输出目录必须使用新路径。不要指向运行中的 toolset。

```sh
bash fork/setup-build-tools.sh /absolute/new/build-tools
python3 -B fork/build.py --output /absolute/new/build-output \
  --node /absolute/new/build-tools/node-v22.23.4-linux-x64/bin/node \
  --bun /absolute/new/build-tools/bun-linux-x64-baseline/bun
```

上游使用 Bun 1.4.4。本配方固定 Node 22.23.4、Bun 1.4.4，
并校验下载包、`bun.lock` 和 readiness 补丁的 SHA256。
Node 版本取自官方 Node 22 LTS 维护元数据；Bun 与上游 `packageManager` 一致。
构建使用独立 HOME、缓存和临时目录，不读取调用者的凭据，不替换现有工具。
只安装 CLI 的 frozen 依赖，禁用安装脚本，然后运行全部 `packages/cli/test/acp` 回归。
测试只用隔离合成 fixture/mock，不恢复业务请求。

构建脚本随后以 `OPENCODE_TARGET=linux-x64-baseline` 和 `--skip-install --skip-web-ui`
编译，并运行编译后程序的 `--version`。`assets/` 包含 tar.gz、独立
`metadata.json` 和 `SHA256SUMS`。压缩包仅包含 `opencode`、`LICENSE`、`metadata.json`。
metadata 记录源码 commit、实际 tag（本地构建为 null）、dirty 状态、源码内容摘要、
上游版本、工具版本、目标和二进制校验和。**dirty 构建只供验证，不得用于发布。**

这是可复用的构建配方，不保证二进制逐字节相同。
上游构建期网络输入、平台工具和 Bun 编译可能影响产物。
下游只能采用实际审核过的 Release asset hash，不能采用本地试构建 hash。
文档中的版本号不表示 Release 已发布。

## 自动化与发布边界

v2.2.0 的全部 **20** 个 workflow 均逐字节归档到 `.github/upstream-workflows/`。
该目录另保留 **23** 个已退出上游的历史文件，共 **43** 个。
本次审核了上游重组的 release/sign/publish、nightly、bot/nix 和 triage 自动化：
它们包含 tag、npm、容器、部署、写权限和自动合并路径，只作为归档保留。
`.github/release/` 和 `.github/nix-hashes/` 的辅助脚本随上游保留，fork 构建不调用它们。
归档文件不运行。维护分支仅保留 `.github/workflows/fork.yml` 为 active。
这不会更改远端默认分支，也不会关闭默认分支上原有的 schedule 或 issue 自动化。
分支 push 和维护 PR 只测试、构建并上传 CI artifact。

只有推送到 `Ricky-Hao/opencode`、符合 `vX.Y.Z-ricky.N` 且精确匹配
`fork/release.json` 的自有 tag 才可发布。仅 publish job 有写权限。
发布要求 clean tagged provenance，并拒绝覆盖已有 Release。
Release 必须是 prerelease，且不得标记 latest。未启用 npm、容器、web 或部署发布。
Actions 继续固定到已审核的 `actions/*` v4.3.1/v4.6.2/v4.3.0 commit。

后续更新应完整集成指定上游 tag/commit，先审构建脚本和新增自动化，
再按语义移植 readiness、更新版本与 hash，并运行相关测试和完整 baseline 构建。
提交前审阅源码、精确 staged diff 和压缩包内容。
负责人单独批准发布后，才对审核过的精确 commit 创建自有 tag 并推送。
下载 Release 后先核 `SHA256SUMS`，再更新下游 tag、asset 和 hash 输入。
已有 Release 不覆盖；需要变更时递增自有版本。
