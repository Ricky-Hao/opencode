# Website guide

## Structure

- This is a standard Astro website with a fully owned frontend.
- Only `base` in `astro.config.ts` should know the deployment subpath. Use `import.meta.env.BASE_URL` everywhere else.
- The documentation feature is self-contained under `src/docs/` and renders through the thin route in `src/pages/docs/`.
- Do not add a documentation frontend framework; this package owns the UI directly.
- Keep the installer route dynamic and `public/openapi.json` generated from `packages/protocol/openapi.json`.

## Local development

- Run `bun dev` from this package and use the local URL printed by Astro.
- Do not run `bun typecheck`, `bun run build`, or another Astro process while the dev server is running. They share the Vite dependency cache and can break the active dev server. 保留现有服务；先完成不冲突的检查，说明受阻项，仅在取得相应停止授权后安排受影响验证，不自动停止服务。

## Validation

- 网站实现、内容、路由或生成接口变化时，从本包运行 `bun typecheck`、`bun run check:generated` 和 `bun run build`。仅维护 AGENTS 指引时做内容/引用审阅及 `git diff --check`，不默认启动 Astro 或跑网站构建。
- Treat validation and build errors as blockers.
