# Project Instructions

- Use Bun for dependency management, scripts, tests, builds, and publishing.
- Keep `bin/wt` generated from `src/cli.ts` with `bun run build`; do not edit the bundle directly.
- Preserve command aliases and observable behavior unless a release explicitly documents a change.
- Treat Git's worktree registry as authoritative for repository-wide discovery.

## Local Docs

- Commander.js 14: async handlers require `parseAsync`; `exitOverride` enables centralized error handling. Version 14 retains Node 20 compatibility. Source: Context7 `/tj/commander.js`, verified 2026-08-25.
- @clack/prompts 1.7: use `select`, `confirm`, and `text`; always detect cancellation with `isCancel`. Source: Context7 `/bombshell-dev/clack`, verified 2026-08-25.
- Bun 1.2: `bun build --target=node` creates the distributable bundle; `bun publish --dry-run` validates npm contents. Source: Context7 `/oven-sh/bun`, verified 2026-08-25.
