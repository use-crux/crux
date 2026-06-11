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

## Project Index Cache Identity

Project Index cache identity is part of the read-model contract. If an indexer or local-runtime change would produce different Project Index output for unchanged user source files, update the relevant structured identity or cache epoch in the same change:

- `packages/indexer/indexer/cache-identity.ts`: bump `STATIC_PARSE_CACHE_EPOCH` when static AST parser/extractor output changes in a way not already captured by source/config hashes, extension/extractor/rule identity, compiler profile identity, or compiler-owned projection identity.
- `packages/indexer/indexer/cache-identity.ts`: bump `SEMANTIC_FACTS_CACHE_EPOCH` when semantic enrichment output changes in a way not already captured by source-closure/config hashes, TypeScript version, or `SEMANTIC_COMPILER_OPTIONS_ID`.
- `packages/indexer/indexer/cache-identity.ts`: update `SEMANTIC_COMPILER_OPTIONS_ID` when TypeScript compiler option meaning changes for semantic enrichment.
- `packages/local/internal/devtools/index_cache_identity.go`: bump `projectIndexSnapshotCacheEpoch` when the Go-owned `IndexData` snapshot shape, cache loading semantics, or client-visible Project Index metadata changes in a way that an existing `.crux/cache/index/index.json` could mask after restart.

For features that span AST output, semantic enrichment, and the Go snapshot, update all affected identities/epochs. Rebuild with `make build`, restart the local server, and run `crux index reindex` (or the reindex HTTP endpoint) to verify the fresh snapshot. Do not ask users to manually delete `.crux/cache` for normal contract migrations.

## Indexer Extensions

`@crux/indexer` is a compiler-style Project Index engine, not a mutable plugin registry. First-party
and third-party Indexer Extensions must contribute through explicit manifests, compiler-owned
extension runtimes, and immutable fact/rule/relation declarations. Do not add global registration,
implicit package discovery, raw TypeScript AST public APIs, or side-effect loader hooks.

Dynamic third-party loading is config-driven. `@crux/core` stores inert `indexer` config data, while
`@crux/indexer` enforces package trust, package/export resolution, installed package-version checks,
manifest validation, and compatibility diagnostics before compiler runtime construction. Importing an
allowlisted package is trusted code execution, not sandboxing.

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
