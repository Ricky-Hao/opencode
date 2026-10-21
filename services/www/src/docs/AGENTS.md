# Documentation feature guide

## Structure

- This folder owns the documentation data model, content, frontend, and styling.
- Documentation content lives in `content/` and is loaded by `../content.config.ts`.
- `lib/navigation.ts` is the source of truth for header sections and sidebar ordering.
- The thin route entrypoints live in `../pages/docs/`; keep docs implementation details here.
- Do not add a documentation frontend framework; this folder owns the UI directly.
- Keep internal Markdown links docs-root-relative, for example `/config`; `remark-links.ts` applies the site and docs base paths.

## Writing Style

- Keep prose sections brief and focused on one idea. Prefer one to three sentences over large paragraphs.
- Interleave explanations with concrete code, configuration, command, or output examples so pages do not become walls of text.
- Put the relevant example immediately after the text that introduces it, following `content/build/plugins/cli.mdx` as the reference pattern.
- Every subsection that explains syntax, fields, or an API concept must include its own minimal example. A larger example earlier on the page does not count.
- Split long explanations with meaningful headings and examples rather than accumulating caveats in one paragraph.
- Lead with the common task and working example; place edge cases and supporting details afterward.
- Do not stack several prose paragraphs without a visual break. After introducing a concept, use an example, list, table, or task-oriented subheading before covering the next concern.
- Use bullets or tables for independent rules, options, and constraints. Do not hide reference material in narrative paragraphs.
- Organize workflow documentation in the order readers perform it, with a working example at each major step.

## Validation

- 文档网站内容或实现变化时，从 `services/www` 运行 `bun typecheck` 和 `bun run build`，并遵守上级的活动 dev server 缓存冲突限制。仅 AGENTS 指引文档变化时做内容/引用审阅及 `git diff --check`，不默认构建网站。
- Check desktop and mobile layouts when changing navigation or shared styles.
