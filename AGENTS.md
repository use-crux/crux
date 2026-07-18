# Crux Repository

Crux is a TypeScript context engineering SDK with adapters, devtools, docs, and a native Go local runtime.

# Personal preferences

## Code style

- Always strive for concise, simple solutions
- If a problem can be solved in a simpler way, propose it.

## Subagents

If you're Fable 5, you're not allowed to run subagents by yourself. Follow the guide below (Picking the right models for workflows and subagents).

If you're not Fable 5, you may use subagents, but preferable follow the guide below to actually use the model that fits the job.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI is near-free for me) not a list price. Intelligence is how hard a problem you can hand to model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model | cost | intelligence | taste |
| gpt-5.6-sol | 7 | 9 | 7 |
| gpt-5.6-terra | 8 | 7 | 6 |
| gpt-5.6-luna | 9 | 5 | 6 |
| grok-build | 9 | 6 | 5 |
| sonnet-5 | 5 | 5 | 7 |
| opus-4.8 | 4 | 7 | 8 |
| fable-5 | 2 | 9 | 9 |

How to apply:

- These are defaults, not limits. You have standing persmission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model. Judge the output. Escalating costs less then shipping mediocre work.
- Bulk/mechanical work (clear-spec, implementation, data analysis, migrations): gpt-5.5 - It's effectively free.
- Anything user-facing (UI, copy, API design) needs taste >= 7.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra independent perspective.
- Mechanics: gpt-5.5 is only reachable through the OpenAI coding-agent CLI.

## Architecture

- Monorepo: pnpm workspaces + Turborepo.
- Runtime packages live in `packages/*`.
- Documentation lives in `apps/docs`.
- Crux Local lives in `packages/local` and provides the `crux` binary, local dev server, TUI, embedded devtools, and bounded helper workers.
- `@use-crux/core` must remain provider-agnostic. Provider packages depend on core, not the other way around.

## Dependency Direction

Allowed:

- `@use-crux/ai` -> `@use-crux/core`
- `@use-crux/openai` -> `@use-crux/core`
- `@use-crux/anthropic` -> `@use-crux/core`
- `@use-crux/google` -> `@use-crux/core`
- `@use-crux/convex` -> `@use-crux/core`
- `@use-crux/next` -> `@use-crux/core` (peer: `next`; binds `after()` only)
- `@use-crux/vercel` -> `@use-crux/core` (peer: `@vercel/functions`; binds `waitUntil()` only)
- `@use-crux/upstash` -> `@use-crux/core`
- `@use-crux/otel` -> `@use-crux/core`
- `@use-crux/ingest` -> `@use-crux/core`
- `@use-crux/react` -> `@use-crux/core`

Avoid:

- `@use-crux/core` depending on provider SDKs, Convex, React, Next, Vercel,
  Cloudflare, or app-specific packages. Provider-neutral defer host ports live
  at `@use-crux/core/defer/node` and `@use-crux/core/defer/serverless`; framework
  packages inject concrete platform hooks.
- Cross-package relative imports. Use workspace package imports.

## Package Rules

- Use `workspace:*` or `workspace:^` for internal `@use-crux/*` dependencies.
- Provider SDKs and host frameworks belong in `peerDependencies` when users should control the installed version.
- Build outputs, generated docs artifacts, and local caches should not be committed.

### Platform package naming

- Runtime composers keep the platform name, such as `cloudflare()` and `convex()`.
- Host and retention bindings use the mechanism name: `next()`, `vercel()`, `node()`, and `workers()`.
- Each framework package has exactly one `withCrux` meaning: its lifecycle boundary.
- Build-time plugins use `withCruxBuild`-style names so they cannot be confused with lifecycle boundaries.

## Changesets

Changesets are the release queue, not a per-commit log. Do not create a new
changeset just because you are a new agent or because you made another commit.

Add or update a changeset only when a change affects npm package users: public
APIs, package exports, install behavior, CLI behavior, runtime behavior,
published package docs, or npm release mechanics.

Before creating a changeset:

1. Inspect existing pending files with `ls .changeset/*.md` and read the ones
   that are not `README.md`.
2. If an existing changeset already describes the current PR or release theme,
   update that file instead of adding another one. Add packages to its front
   matter when needed, raise the bump level if the new change requires it, and
   append a concise user-facing note.
3. Create a new changeset only when there is no relevant pending changeset.
4. If multiple agents are working on the same PR, one agent should own the
   changeset. Other agents should report the package impact in their final
   message instead of creating duplicate files.

Use `patch` for compatible fixes, `minor` for new public behavior, and `major`
for breaking changes. Because `@use-crux/*` packages are fixed together in
Changesets config, select only the directly affected package names; the release
PR will align the full package group.

Do not add changesets for tests-only changes, internal docs-only edits, or
refactors with no package-user impact. In final responses, state either the
changeset file you added/updated or that no changeset was needed.

## Build Commands

Prefer root `make` targets for repository workflows:

- `make build` builds local TypeScript worker bundles and devtools UI, embeds them into the Go binary, builds the current-platform Rust/Oxc indexer worker, then builds Crux Local. It must not run the root Turbo build or build `docs`.
- `make local` builds local TypeScript worker bundles and devtools UI, embeds them into `packages/local/internal/assets/{embed,ui-embed}`, builds the current-platform Rust/Oxc indexer worker, then builds the current-platform Go binary.
- `make local-go` rebuilds only the Go binary from already embedded assets.
- `make local-all` builds embedded platform Go binaries and Rust/Oxc indexer workers under `packages/local/dist/`.
- `make cli`, `make cli-go`, and `make cli-all` are compatibility aliases for the local targets.
- `make docs` runs the docs app.

The lower-level `packages/local/Makefile` owns Go-specific build details. Do not manually copy local worker or devtools UI assets for normal builds; use `make local` or `make -C packages/local build`.

## Project Index Cache Identity

Project Index cache identity is part of the read-model contract. If an indexer or local-runtime change would produce different Project Index output for unchanged user source files, update the relevant structured identity or cache epoch in the same change:

- `packages/indexer/src/indexer/cache-identity.ts`: bump `STATIC_PARSE_CACHE_EPOCH` when static AST parser/extractor output changes in a way not already captured by source/config hashes, extension/extractor/rule identity, compiler profile identity, or compiler-owned projection identity.
- `packages/indexer/src/indexer/cache-identity.ts`: bump `SEMANTIC_FACTS_CACHE_EPOCH` when semantic enrichment output changes in a way not already captured by source-closure/config hashes, TypeScript version, or `SEMANTIC_COMPILER_OPTIONS_ID`.
- `packages/indexer/src/indexer/cache-identity.ts`: update `SEMANTIC_COMPILER_OPTIONS_ID` when TypeScript compiler option meaning changes for semantic enrichment.
- `packages/local/internal/projectindex/cache/identity.go`: bump `ProjectIndexSnapshotCacheEpoch` when the Go-owned `IndexData` snapshot shape, cache loading semantics, or client-visible Project Index metadata changes in a way that an existing `.crux/cache/index/index.json` could mask after restart.

For features that span AST output, semantic enrichment, and the Go snapshot, update all affected identities/epochs. Rebuild with `make build`, restart the local server, and run `crux index reindex` (or the reindex HTTP endpoint) to verify the fresh snapshot. Do not ask users to manually delete `.crux/cache` for normal contract migrations.

## Eval Evidence Cache Identity

Eval evidence identity is part of the automatic reuse contract. Over-invalidate, never under-invalidate: a stale evidence hit is a correctness bug, while an extra task or scorer run is only slower. If an Eval engine change would alter task-evidence keys, managed-scorer keys, Baseline comparability, or judge score comparability for unchanged user Eval source, update the relevant identity epoch in the same change:

- `packages/core/src/eval/internal/evidence/cache-epochs.ts`: bump `TASK_EVIDENCE_CACHE_EPOCH` when task evidence identity or reuse semantics change in a way not already captured by Eval/Case input and call, Variant, trial, managed-task, adapter, host-contract, and occurrence fingerprints.
- `packages/core/src/eval/internal/evidence/cache-epochs.ts`: bump `SCORER_RESULT_CACHE_EPOCH` when managed external-scorer evidence identity changes in a way not already captured by input, expected value, task output/response/signals, scorer contract, host contract, Variant, trial, and occurrence.
- `packages/core/src/eval/internal/evidence/cache-epochs.ts`: bump `BASELINE_FINGERPRINT_EPOCH` when Baseline snapshot or granular Case/metric comparability changes in a way not already captured by the stored coverage and provenance fingerprints.
- `packages/core/src/eval/internal/evidence/cache-epochs.ts`: bump `JUDGE_PROMPT_VERSION` when the built-in judge prompt template changes in a way that can affect judge score comparability.

For changes spanning task evidence reuse, scorer evidence reuse, and Baselines, update all affected epochs and add focused red tests proving stale artifacts are missed or marked incompatible instead of reused.

## Indexer Extensions

`@use-crux/indexer` is a compiler-style Project Index engine, not a mutable plugin registry. First-party
and third-party Indexer Extensions must contribute through explicit manifests, compiler-owned
extension runtimes, and immutable fact/rule/relation declarations. Do not add global registration,
implicit package discovery, raw TypeScript AST public APIs, or side-effect loader hooks.

Dynamic third-party loading is config-driven. `@use-crux/core` stores inert `indexer` config data, while
`@use-crux/indexer` enforces package trust, package/export resolution, installed package-version checks,
manifest validation, and compatibility diagnostics before compiler runtime construction. Importing an
allowlisted package is trusted code execution, not sandboxing.

## Experimental Config

Unstable user-facing options belong under the top-level `experimental` object, following a
Next.js-style graduation path. For Project Indexer native semantic experiments, use
`experimental.indexer.native: true | { engine?: 'tsgo'; tsserverPath?: string }`. For Project
Indexer native static AST experiments, use
`experimental.indexer.nativeAst: true | { frontend?: 'oxc' }`.
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
experimental while its upstream APIs and benchmark confidence mature; supported semantic output must
still match the TypeScript backend exactly. Backend work should
update the semantic backend parity fixtures/tests in the same change whenever new semantic behavior
is added or changed.

Native semantic projectors, such as TypeScript-Go fast paths for high-volume source shapes, are
optimizations behind the shared semantic evidence contract. They must prove exact normalized fact
parity with the JavaScript TypeScript backend for supported syntax and must route unsupported syntax
through the native backend's complete shared analyzer path instead of emitting partial native-only
facts.
Current first-party native direct coverage includes prompt/context/tool schema and source refs,
prompt/context `use` and `tools` dependencies, agent prompt/tool/model-routing/callback config refs
and literal handoff relations, and local `router`/`cascade`/`fallback` child definitions, target
relations, callback refs, and routing target source refs. Changes to any of those semantic shapes
must update the direct projector and the semantic-native parity tests in the same change.
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
3. Keep package names published as `@use-crux/*`; local folder names intentionally omit the old `crux-` prefix.

Publishing to npm is not required for Karyla or Vercel while Karyla consumes this submodule through pnpm workspaces. npm publishing is the later external-consumer release path.
