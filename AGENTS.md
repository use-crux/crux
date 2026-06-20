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

## Experimental Config

Unstable user-facing options belong under the top-level `experimental` object, following a
Next.js-style graduation path. For Project Indexer native experiments, use
`experimental.indexer.native: true | { engine?: 'tsgo'; tsserverPath?: string }`.
Do not add stable-looking `indexer.semantic` backend switches, public `unstableApi` config fields,
or TypeScript-Go-specific public backend flags; `tsgo` is an internal native engine option.

## Semantic Indexer Backends

Semantic Project Index behavior must stay backend-neutral. Any change to semantic facts,
source refs, relations, lint findings, cache identity, diagnostics, or compiler option behavior
must be implemented through the shared semantic evidence/backend interface and verified for both
the JavaScript TypeScript backend and the native backend. Do not add semantic
capabilities to only one backend, and do not expose raw TypeScript or TypeScript-Go AST/checker
objects to extensions.

Static/source indexing is a separate syntax-frontend concern. It may move to a native Rust/Oxc-style
frontend before semantic indexing moves further native, but it must keep emitting the same Project
Index facts, source graph rows, and semantic scope handoff used by the semantic worker. Do not make
semantic backends depend on a specific static parser implementation.

The JavaScript TypeScript backend remains the default correctness baseline. The native backend is
experimental while its engines, coverage model, upstream APIs, and benchmark confidence mature;
supported semantic output must still match the TypeScript backend exactly. Backend work should
update the semantic backend parity fixtures/tests in the same change whenever new semantic behavior
is added or changed.

Native semantic projectors, such as TypeScript-Go fast paths for high-volume source shapes, are
optimizations behind the shared semantic evidence contract. They must prove exact normalized fact
parity with the JavaScript TypeScript backend for supported syntax and must route unsupported syntax
through the native backend's complete shared analyzer path instead of emitting partial native-only
facts.
Where native projector behavior can be expressed as primitive projection data, keep it in an
explicit manifest: call names, definition identity fields, schema properties, dependency relations,
source-ref roles, and supported local reference forms. Do not add unexplained hardcoded first-party
primitive branches to native projectors when a manifest entry can represent the shape. Third-party
Indexer Extensions remain backend-neutral; native acceleration for extension primitives must be
derived from explicit extension/compiler declarations when supported, and otherwise must use the
native shared analyzer path.

Semantic preflight should produce or consume one shared source profile for a selected semantic scope:
dependency closure, byte counts, source hashes, and transient source text. Cache identity, native
projector guards, and backend setup should share that profile instead of independently rereading the
same files. Future Go or native AST frontends may provide equivalent source fingerprints before the
semantic worker runs, but semantic backends must continue to consume the backend-neutral contract.

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
