# @use-crux/core Stable Beta Contract

`@use-crux/core` is a stable beta package. Stable beta means the listed core
composition and adapter contracts are intended for real application use while
Crux remains pre-1.0.

## Compatibility Promise

Breaking changes to the stable beta surface require a minor-version bump and
CHANGELOG migration notes while Crux is pre-1.0. Patch releases may add optional
fields, new helpers, diagnostics, docs, and compatible behavior fixes.

## Stable Surface

The stable beta surface is:

- `prompt`, `context`, `contributor`, `when`, and `match`
- `createPrompts` and `createContexts`
- `.resolve()` and `.inspect()`
- `ResolvedPrompt`, `SystemBlock`, and `InspectResult`
- `GenerationSettings` and `ProviderAdaptations`
- the `generate` and `stream` result contract, including the canonical result
  envelope and stream `completion` envelope
- `AdapterSpec`, `LoopRuntimePort`, `ExecutorRequest`, and `ExecutorOutcome`
- public adapter codecs and headless call handles
- adapter `transport` callbacks for `generate()`; `stream()` with `transport`
  is explicitly unsupported unless a future subpath documents support

Everything else is labelled by subpath. Memory, retrieval, skills, agents,
flows, quality, and local/devtools surfaces keep their existing beta or
experimental status unless their own subpath documentation says otherwise.

## Quality (`@use-crux/core/eval`)

Quality is **beta**: the authoring surface (`evaluate`, `target`, `scorers`,
`dataset`, `cassette`), the experiment/manifest record schemas
(`quality/schemas`), CLI JSON outputs, and exit codes are stable within 0.x
minors. Breaking changes get a changeset `minor` and a migration note.
`quality/internal/runner` remains internal with no guarantees.

## Runtime Engine (`@use-crux/core/runtime`)

The durable Runtime Engine and its runtime store adapter contract are stable
beta. This includes `node()`, `serverless()`, `genericQueue()`,
`createRuntimeHandler()`, `createRuntime()`, `bindHostRuntime()`,
`durableTask()` targets, wake envelopes, diagnostics, `RuntimeStoreAdapter`,
named kernel composites, retention and lease behavior, and the runtime
conformance suites under `@use-crux/core/runtime/testing`.

Breaking Runtime Engine changes require the same minor-version bump and
migration-note treatment as the core stable beta surface while Crux remains
pre-1.0. Patch releases may add optional fields, diagnostics, helpers, and
compatible behavior fixes. Host-specific integrations and adapters not covered
by their package documentation may still be experimental.

## Observability (`@use-crux/core/observability`, `@use-crux/otel`)

Observability is **stable beta** for the v3 graph record contract (`schemaVersion: 3`, `runId` /
`traceId` / `segmentId` / `segmentSeq`), the `run:start` / `run:suspend` / `run:resume` / `run:end`
lifecycle and its explicit ownership API (`observe.openRun()`, `observe.resumeRun()`, the returned
handle's `.suspend()` / `.end()` / `.error()`), the delivery receipt/idempotence contract, the host
lifecycle port and its first-party Node/serverless/Workers/Convex wrappers, and `@use-crux/otel`'s
active execution bridge and W3C propagation helpers. There is no v1 wire/storage compatibility: the
pre-launch v2 cutover destructively removed pre-v2 local observability rows rather than carrying a
dual-read window, so this beta line starts clean at v2.

Real cross-runtime conformance (fresh-process Node, real workerd, a serverless freeze harness, and
Convex bundle/runtime tests) backs this contract. See the current release's changeset and CHANGELOG
for exact soak scope and known residual limitations before depending on it for a production release
gate.

## Platform Floor

Published Crux packages are ESM-only and require Node.js 22 or newer. Package
exports provide `types` and `import` entries only; CommonJS `require`
conditions are intentionally not part of the pre-1.0 contract.

## Experimental Surface & Graduation

Unstable user-facing APIs ship under the `experimental` config object or an
`experimental`-prefixed export, mirroring the existing
`experimental.indexer.*` convention. Graduation renames the API to its stable
name. Pre-1.0, graduation and every other breaking change are hard breaks in a
minor release: no deprecated aliases, no compatibility shims, no codemods —
the CHANGELOG migration note is the migration tool. Crux will not reach 1.0
with any `experimental` name already known to be graduating.

From 1.0, the discipline inverts: breaking changes require a major release,
renames ship with a deprecated alias for at least one minor, and larger
migrations ship codemods.

## Ordering Guarantee

The prompt's own system text always comes first. Cached contexts (`cache: true`)
follow it as a stable prefix, then uncached contexts; each group keeps `use`
array order. The composed prefix is byte-stable across calls given identical
prefix-context inputs. Budget pressure only ever drops uncached blocks, and
never reorders anything.

## Prompt-Level Quality Controls

`constraints` and `guardrails` intentionally remain available on prompt and
context config. This differs from frameworks that keep safety controls only at
agent or middleware layers; Crux treats the prompt definition as the unit of
quality, alongside colocated tests and output schemas.

## Additive Metadata

Optional metadata on context definitions, context segments, resolver artifacts,
and inspection records is reserved for compatible additions. New optional fields
such as freshness facts are non-breaking when existing required fields and
semantics remain intact.
