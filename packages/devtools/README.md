# @use-crux/devtools

React web devtools for `@use-crux/core` and Crux Local. The UI inspects prompts,
contexts, production runs, Evals, Eval runs, Baselines, Review work, Project
Index data, and lint findings served by the Go local runtime.

## Ownership

`@use-crux/devtools` owns the browser UI only:

- Vite/React source under `ui/`
- UI-local tests
- UI architecture checks
- static assets embedded by `@use-crux/local`

It does not own TypeScript compiler worker entrypoints. Those live in the
private `@use-crux/local-workers` package and are embedded separately by the
local runtime build.

## Build

```bash
pnpm --filter @use-crux/devtools build
```

This builds the UI into `packages/devtools/ui/dist/`.

For the full local runtime pipeline, use the root Makefile:

```bash
make local
```

`make local` builds `@use-crux/local-workers`, builds this UI package, embeds both
asset groups into `packages/local/internal/assets`, builds the Rust/Oxc Static
Index worker, and then builds the Go `crux` binary.

## Development

```bash
pnpm --filter @use-crux/devtools dev
pnpm --filter @use-crux/devtools typecheck
pnpm --filter @use-crux/devtools test
```

The Vite dev server proxies `/api` and `/ws` to the local Go server on port 4400.
