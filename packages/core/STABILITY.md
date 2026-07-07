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
- the `generate` and `stream` result contract
- `AdapterSpec`, `LoopRuntimePort`, `ExecutorRequest`, and `ExecutorOutcome`

Everything else is labelled by subpath. Memory, retrieval, skills, agents,
flows, quality, and local/devtools surfaces keep their existing beta or
experimental status unless their own subpath documentation says otherwise.

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
