# Crux Repository

Crux is a TypeScript context engineering SDK with adapters, devtools, docs, and a native Go CLI.

## Architecture

- Monorepo: pnpm workspaces + Turborepo.
- Runtime packages live in `packages/*`.
- Documentation lives in `apps/crux-docs`.
- The native CLI lives in `packages/crux-cli`.
- `@crux/core` must remain provider-agnostic. Provider packages depend on core, not the other way around.

## Dependency Direction

Allowed:

- `@crux/ai` -> `@crux/core`
- `@crux/openai` -> `@crux/core`
- `@crux/anthropic` -> `@crux/core`
- `@crux/google` -> `@crux/core`
- `@crux/convex` -> `@crux/core`
- `@crux/upstash` -> `@crux/core`
- `@crux/otel` -> `@crux/core`
- `@crux/ingest` -> `@crux/core`
- `@crux/react` -> `@crux/core`

Avoid:

- `@crux/core` depending on provider SDKs, Convex, React, or app-specific packages.
- Cross-package relative imports. Use workspace package imports.

## Package Rules

- Use `workspace:*` or `workspace:^` for internal `@crux/*` dependencies.
- Provider SDKs and host frameworks belong in `peerDependencies` when users should control the installed version.
- Build outputs, generated docs artifacts, and local caches should not be committed.

## Build Commands

Prefer root `make` targets for repository workflows:

- `make build` builds TypeScript packages/apps through Turbo, then builds the embedded CLI.
- `make cli` builds devtools workers/UI, embeds them into `packages/crux-cli/internal/server/{embed,ui-embed}`, then builds the current-platform Go binary.
- `make cli-go` rebuilds only the Go binary from already embedded assets.
- `make cli-all` builds embedded platform binaries under `packages/crux-cli/dist/`.
- `make docs` runs the docs app.

The lower-level `packages/crux-cli/Makefile` owns Go-specific build details. Do not manually copy devtools assets for normal builds; use `make cli` or `make -C packages/crux-cli build`.

## Open Source Prep

Before making the repo public:

- Remove Karyla-specific secrets, URLs, fixtures, and private product assumptions.
- Ensure package manifests publish compiled `dist` files rather than raw source.
- Run typecheck, tests, secret scanning, and license review.
- Replace the private cleanup history with a clean initial public commit if desired.
