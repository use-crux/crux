# Crux Repository

Crux is a TypeScript context engineering SDK with adapters, devtools, docs, and a native Go local runtime.

## Architecture

- Monorepo: pnpm workspaces + Turborepo.
- Runtime packages live in `packages/*`.
- Documentation lives in `apps/docs`.
- Crux Local lives in `packages/local` and provides the `crux` binary, local dev server, TUI, embedded devtools, and bounded helper workers.
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

- `make build` builds devtools workers/UI, embeds them into the Go binary, then builds Crux Local. It must not run the root Turbo build or build `docs`.
- `make local` builds devtools workers/UI, embeds them into `packages/local/internal/server/{embed,ui-embed}`, then builds the current-platform Go binary.
- `make local-go` rebuilds only the Go binary from already embedded assets.
- `make local-all` builds embedded platform binaries under `packages/local/dist/`.
- `make cli`, `make cli-go`, and `make cli-all` are compatibility aliases for the local targets.
- `make docs` runs the docs app.

The lower-level `packages/local/Makefile` owns Go-specific build details. Do not manually copy devtools assets for normal builds; use `make local` or `make -C packages/local build`.

## Project Index Cache Versions

Project Index cache versions are part of the read-model contract. If an indexer or local-runtime change would produce different catalog output for unchanged user source files, update the relevant cache version in the same change:

- `packages/indexer/indexer/static-cache.ts`: bump `CACHE_VERSION` when the static AST parser/extractors change `StaticParseResult` content or shape, including new definitions, relations, metadata, `sourceRefs`, diagnostics, schemas, presentation hints, file classification, or id/path/source behavior.
- `packages/indexer/indexer/semantic-cache.ts`: bump `CACHE_VERSION` when semantic enrichment changes `IndexPatchFacts` content or shape, including TypeScript-resolved aliases, nested schemas, source refs, runtime joins, intelligence metadata, relations, lint facts, or compiler option semantics.
- `packages/local/internal/devtools/index_cache.go`: bump `indexCacheFormatVersion` when the Go-owned `IndexData` snapshot shape, cache loading semantics, or client-visible catalog metadata changes in a way that an existing `.crux/cache/index/index.json` could mask after restart.

For features that span AST output, semantic enrichment, and the Go snapshot, bump all three. Rebuild with `make build`, restart the local server, and run `crux catalog reindex` (or the reindex HTTP endpoint) to verify the fresh snapshot. Do not ask users to manually delete `.crux/cache` for normal contract migrations.

## Open Source Prep

Before making the repo public:

- Remove Karyla-specific secrets, URLs, fixtures, and private product assumptions.
- Ensure package manifests publish compiled `dist` files rather than raw source.
- Run typecheck, tests, secret scanning, and license review.
- Replace the private cleanup history with a clean initial public commit if desired.

## Karyla Integration

Karyla consumes this repository as the `crux/` Git submodule using the public HTTPS URL `https://github.com/use-crux/crux.git`.

For Crux changes made from inside Karyla:

1. Commit and push changes in this repository first.
2. Then commit the updated `crux` submodule pointer in the parent Karyla repository.
3. Keep package names published as `@crux/*`; local folder names intentionally omit the old `crux-` prefix.

Publishing to npm is not required for Karyla or Vercel while Karyla consumes this submodule through pnpm workspaces. npm publishing is the later external-consumer release path.
