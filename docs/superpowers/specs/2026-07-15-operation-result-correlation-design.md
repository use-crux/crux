# Cross-Crux Operation Result Correlation Design

## Status

This document expands GitHub issue #221 from a generation-only convenience
field into a coherent result-correlation contract for Crux. It is a design and
rollout specification, not an implementation.

The first implementation must preserve the central promise of issue #221:
after a successful managed generation, application code can navigate from the
returned result to the exact Crux operation that produced it. The design also
accounts for streaming, multimodal operations, agents, compositions, durable
flows, evaluation, caches, routing, and lower-level primitives so that the
initial API does not become a generation-specific dead end.

## Executive decision

Crux should standardize one operation-result correlation vocabulary across the
repository:

```ts
import type { CruxSpanId, CruxTraceId } from "@use-crux/core/observability";

/** Exact observability identity of the Crux operation that produced a result. */
export interface OperationResultMeta {
  /** W3C trace containing the producing operation and its causal descendants. */
  readonly traceId: CruxTraceId;
  /** Exact Crux span that produced this result envelope. */
  readonly spanId: CruxSpanId;
}
```

Successful public operation envelopes expose this identity under `_meta`.
They do not expose only a trace ID: a trace can contain generation, tools,
retrieval, media, agents, and compositions, so `traceId` alone cannot identify
which operation produced the value. The pair also matches the existing
Devtools permalink identity: `/runs/:traceId?spanId=:spanId`.

This is a semantic convention, not a mandate to mutate every value returned by
Crux. The repository has four distinct return families:

1. **Operation envelopes** get `_meta: OperationResultMeta`.
2. **Bare values, durable records, and long-lived handles** keep their natural
   shape; a future detailed operation API may wrap them when correlation is
   useful.
3. **Transparent wrappers** preserve the producing operation's metadata.
4. **Multi-operation aggregates** expose an explicit collection of operation
   or run references instead of pretending one span produced the aggregate.

The contract is designed repository-wide now, then implemented in coherent
vertical slices. A partially shipped public guarantee is acceptable only when
the documentation names exactly which result families implement it; competing
identity formats or generation-only semantics are not.

## What issue #221 is actually about

Issue #221 asks for `result._meta.traceId` on managed, non-streaming generation
results. Its immediate use case is application-level correlation with Crux
Devtools and observability records. It distinguishes Crux correlation from the
provider response identifier already stored as `_meta.responseId`.

The narrow proposal is insufficient as a lasting contract for three reasons:

- a trace contains multiple operations, so a trace ID is a group locator rather
  than the identity of the result-producing operation;
- `stream()` returns before provider completion but still owns an operation
  immediately, and media operations already use a shared bounded-operation
  lifecycle outside the text generation accumulator;
- higher-level primitives produce new public envelopes with their own spans.
  Reusing a child generation's identity for an agent, pipeline, or flow result
  would make the API lie about which abstraction produced the envelope.

The issue should therefore become the first tracer bullet for a cross-Crux
operation-result correlation contract, while retaining a deliberately small
metadata payload.

## Identity semantics

Crux already defines four branded observability identities. They must not be
treated as interchangeable strings.

| Identity        | Meaning                                                                 | Result metadata          |
| --------------- | ----------------------------------------------------------------------- | ------------------------ |
| `CruxTraceId`   | W3C distributed causal trace; shared by related operations              | Required                 |
| `CruxSpanId`    | One exact timed operation inside the trace                              | Required                 |
| `CruxRunId`     | One user-visible logical run, possibly spanning suspend/resume segments | Not in the common pair   |
| `CruxSegmentId` | One contiguous physical execution segment                               | Never in result metadata |

`runId` is valuable for durable and evaluation read models, but it is not part
of the smallest portable operation reference. An operation result needs the
W3C-compatible trace and exact span; Devtools already resolves that pair.
Aggregates that truly need logical-run lookup use a separate run reference:

```ts
/** Durable lookup identity for one observed logical run. */
export interface OperationRunRef {
  readonly runId: CruxRunId;
  readonly traceId: CruxTraceId;
}
```

`segmentId` is intentionally excluded. It is a physical execution detail that
changes across serverless boundaries and flow resumption. Persisting it on a
logical result would make a valid reference appear tied to an obsolete host
segment.

### Parent and child operations

Nested operations normally share `traceId` and have distinct `spanId` values:

```text
composition.pipeline       trace A, span 01  -> PipelineResult._meta
  agent.run                 trace A, span 02  -> AgentResult._meta
    generation.call         trace A, span 03  -> GenerateResult._meta
      tool.call             trace A, span 04  -> tool evidence/context
```

Every envelope points at the span owned by its abstraction. A parent result
must not copy the last child result's `spanId`. Siblings may complete in any
order without affecting this rule.

Related work is not guaranteed to share a trace when it is deliberately
detached, scheduled as independent durable work, or crosses a boundary without
a propagation carrier. In those cases Crux records causal edges rather than
fabricating trace continuity.

## Public type design

### Shared types

Place the stable identity contract in a small observability-owned module, for
example `packages/core/src/observability/result-meta.ts`, and export it from
`@use-crux/core/observability` and the core root.

The public generic should preserve domain metadata while making Crux-owned
keys authoritative:

```ts
type ExistingResultMeta<TResult> = TResult extends {
  readonly _meta?: infer TMeta;
}
  ? NonNullable<TMeta> extends object
    ? NonNullable<TMeta>
    : Record<never, never>
  : Record<never, never>;

/** Add exact Crux correlation while retaining non-reserved result metadata. */
export type WithOperationResultMeta<TResult extends object> =
  TResult extends unknown
    ? Omit<TResult, "_meta"> & {
        readonly _meta: Readonly<
          Omit<ExistingResultMeta<TResult>, keyof OperationResultMeta> &
            OperationResultMeta
        >;
      }
    : never;
```

The outer conditional deliberately distributes over discriminated result
unions, so every member keeps its own fields and metadata. Test that behavior
against `FlowResult` and the concrete media result unions. If the helper
obscures generated API documentation or produces poor editor hovers, prefer
explicit result interfaces and keep the generic internal. Advanced conditional
types are justified only at the common core/provider boundary; user-facing
types should remain readable.

JSDoc should follow the style used by Next.js and the AI SDK: state the public
behavior first, identify ownership and timing, and include one short example.
It should not narrate the implementation.

### Generation metadata

The current `TraceMeta` name is misleading: it contains provider and policy
facts such as usage, finish reason, response ID, constraints, and guardrails,
but not a Crux trace. Do not force provider adapters to invent core-owned
correlation by adding required fields to that provider-facing shape.

Split the concepts:

```ts
/** Provider-neutral facts accumulated while executing a generation. */
export interface GenerationMeta {
  // current TraceMeta fields: usage, cost, finishReason, responseId, ...
}

/** Metadata on a completed managed generation result. */
export type GenerateResultMeta = Readonly<GenerationMeta & OperationResultMeta>;

/** @deprecated Use GenerationMeta. */
export type TraceMeta = GenerationMeta;
```

Provider decoders, accumulators, and policy middleware produce or augment
`GenerationMeta`. Only the core orchestration boundary produces
`GenerateResultMeta`. This preserves dependency direction and prevents a
provider package from claiming observability identity it does not own.

`GenerateResult._meta` becomes required and uses `GenerateResultMeta`.
`PromptResult` passed to `onGenerate` uses the same required metadata. Internal
middleware shapes may remain partial while work is in flight, but the public
success boundary may not.

### Completed media payloads

Image generation, transcription, speech generation, and future description
operations validate and freeze provider results before the common core runner
finishes them. Separate the provider payload from the observed public result:

```ts
/** Provider-validated completed media payload, before core correlation. */
export type CompletedOperationPayload<TRaw, TMetadata, TWarning> = Readonly<{
  warnings: readonly TWarning[];
  providerMetadata?: TMetadata;
  execution: OperationExecution;
  raw: TRaw;
}>;

/** Core-finalized completed operation result. */
export type CompletedOperationResult<TRaw, TMetadata, TWarning> =
  WithOperationResultMeta<CompletedOperationPayload<TRaw, TMetadata, TWarning>>;
```

Definitions and provider validators are parameterized by the payload. The
shared runner returns the observed result. This is more honest than making
providers return a public type whose required IDs do not exist until the core
runner owns the operation.

Apply the same split to the operation-specific shapes. Provider definitions
return `GenerateImagePayload`, `TranscriptionPayload`, or
`GenerateSpeechPayload`; the bound public functions return the corresponding
`*Result = WithOperationResultMeta<*Payload>`. Keep those payload types in the
adapter-author surface if third-party definitions need to name them. Validation
helpers accept payloads, never public observed results.

## Core-owned stamping

Correlation must be attached from the explicit open span, not rediscovered
from ambient async context:

```ts
const operation = { traceId: span.traceId, spanId: span.spanId };
return withOperationResultMeta(result, operation);
```

This makes behavior deterministic without `AsyncLocalStorage`, across
concurrency, and after asynchronous provider work. It also prevents an inner
span from accidentally becoming the result identity.

The internal helper should create a new Crux-owned envelope and be
authoritative:

- preserve the result prototype, property descriptors, and symbol-keyed own
  fields without evaluating unrelated getters;
- preserve non-reserved `_meta` fields;
- overwrite incoming `traceId` and `spanId` unconditionally;
- support frozen/sealed provider results by returning a new envelope;
- never mutate cached or provider-owned objects in place;
- reject unsupported primitive values at an owning envelope boundary rather
  than silently dropping the guarantee.

Build the clone with property descriptors while omitting the original `_meta`
descriptor, then define one enumerable `_meta` value containing the merged
facts. Do not use object spread as the generic implementation: SDK result
objects may expose lazy getters. The helper is only for known Crux result
envelopes, not arbitrary class instances or provider `raw` values.

The existing `setMeta()` mutator is not sufficient: it is a no-op for primitive
values and can fail on frozen results. Keep it for legacy internal uses or
replace those uses separately; do not make it the new contract's foundation.

### Ownership rules

Use these rules at every boundary:

1. An abstraction that creates a new public operation envelope stamps its own
   span reference.
2. A transparent decorator or router that returns the same abstraction
   preserves the producing operation reference.
3. If an owning primitive accepts a replacement envelope from middleware, it
   restamps the replacement before public hooks and return.
4. Domain records, protocol payloads, and long-lived command handles do not
   acquire ephemeral operation metadata merely because they were touched under
   a span.
5. Aggregates over multiple runs carry a collection of references.

## Generation contract

### Non-streaming

`orchestrateGenerate()` opens `generation.call`. After the adapter loop and
result-building policy complete, it stamps `{ traceId, spanId }` from that exact
span.

Middleware requires two finalization points. The adapter-facing `next()` result
is stamped before it resolves back to middleware, and the result returned by
the entire middleware chain is stamped again before hooks/public return. The
second stamp makes middleware replacement and cache-hit short circuits
authoritative. Layered middleware adds one complication: an inner middleware
can return a cached/replacement result without calling its own `next()`. The
middleware composition mechanism must therefore apply an internal result
finalizer at every `next()` return boundary, not only at the bottom adapter
callback. The finalizer can be threaded through internal call state; it must
not recover identity from ambient context.

The observable order is:

1. provider/core-step result construction;
2. finalization before each awaiting middleware layer receives `next()`;
3. authoritative finalization after the outermost middleware returns;
4. `prompt.hooks.onGenerate`;
5. observability output/usage recording and public promise resolution.

Tests must cover a layered outer middleware around a semantic-cache hit, an
inner replacement, and an outer replacement. Any middleware observing a
successful `await next()` result gets the producing operation pair. A layer
that returns without calling `next()` cannot observe a downstream result, but
its returned value is finalized for its caller and the public boundary.

Text and structured results use the same path. Multimodal input/output content
inside ordinary generation does not require another metadata shape.

`responseId` remains provider-owned and distinct:

```ts
result._meta.responseId; // provider response, if supplied
result._meta.traceId; // Crux causal trace
result._meta.spanId; // exact Crux generation operation
```

### Streaming

A stream is one operation with two useful views:

- the immediate stream handle, available as soon as `stream()` returns;
- the final completion, available after terminal provider state is known.

Both expose the same `OperationResultMeta` pair from `generation.stream`.
The handle can expose the pair immediately because Crux opens the span before
calling the provider. Provider facts such as usage, finish reason, response ID,
and final structured output remain completion-only.

```ts
const stream = await stream(prompt, options);
stream._meta.traceId;
stream._meta.spanId;

const completion = await stream.completion;
completion._meta.traceId === stream._meta.traceId;
completion._meta.spanId === stream._meta.spanId;
```

Do not add correlation to every text delta or object patch. Chunks are events
inside the stream operation, not independently navigable result envelopes.
Partial consumption, consumer cancellation, provider error, and never-consumed
streams must not cause the public handle's IDs to change. A rejected completion
has no success result; failure correlation remains available through the handle
and recorded span.

Both adapter dialects require parity:

- core-step `StreamResult`;
- SDK-loop `ExecutorStreamHandle` and its completion bridge.

The layered middleware finalizer described for non-streaming generation also
applies to the immediate stream handle. It stamps the handle visible after
`await next()`; the outer stream-observability attachment then wraps that
returned handle's terminal/completion channels without changing its pair.

The stream finalizer may end the span on raw-stream terminal state or on a
completion fallback. That lifecycle choice is independent of correlation;
the pair is captured lexically when the span opens.

### Sans-I/O preparation

`prepare()` and `CallHandle` describe provider I/O without necessarily owning
a complete managed Crux execution span. They must not fabricate result
correlation. If a prepared handle is later executed through the managed
orchestrator, that execution's result receives metadata. Direct user-managed
wire execution remains outside this guarantee until it gains an explicit
observed execution boundary.

The compaction-oriented raw `generateTextFn`/`generateObjectFn` provider helpers
also remain provider-call ports. Their enclosing Crux primitive, such as
`compaction.run` or `scoring.judge`, owns the public correlated envelope.

## Cache and replay semantics

Operation identity is invocation-local and must never be serialized as cached
business data.

The semantic cache currently copies all of `_meta`. Its serializer must omit
at least `traceId` and `spanId`. Hydration restores provider/policy metadata,
then the current owning generation stamps its own pair. A hit therefore points
at the current `generation.call` or `generation.stream`, not the historical
operation that originally populated the cache.

If Crux wants historical lineage, it should record a `replay.of` edge or a
dedicated cache-origin reference in observability. It must not overload the
public result's producing-operation identity.

Provider `responseId` replay policy remains a separate decision. It may be
useful provider data from the cached response; it is not a Crux operation ID.

No Project Index cache identity changes are implicated. Stripping ephemeral
metadata does not alter semantic-cache keys. Eval evidence identity and cache
keys remain unchanged because the current wire model already uses `runIds`.

## Routing, retry, and fallback

Routers, cascades, fallback, retry, and semantic cache are transparent with
respect to the public generation/media abstraction. Their receipts and attempt
spans explain how the operation completed; they do not replace the result's
owning operation reference.

For a routed generation result:

- `_meta.traceId`/`spanId` point to the outer managed generation span;
- `_meta.responseId` and model facts describe the selected provider result;
- `_meta.routing` or the existing routing receipt describes selection and
  attempts;
- attempt spans remain discoverable as children in the trace.

`ensureRoutingResult()` must preserve already-authoritative metadata. A routing
wrapper that creates a genuinely new public operation envelope follows the
normal ownership rule and stamps its own span.

## Completed multimodal operations

The shared `runCompletedMediaOperation()` boundary covers:

- `generateImage()` -> `media.generate_image`;
- `transcribe()` -> `media.transcribe`;
- `generateSpeech()` -> `media.generate_speech`;
- future semantic `describe()` -> `media.describe`.

Extend `CompletedMediaObservation` to expose the opened span's `traceId` and
`spanId`. Stamp the final cloned result in the common lifecycle after provider
validation/finalization and before return. One shared conformance suite should
prove the rule for all operation definitions.

Composed media operations may call generation or another media operation.
The public media result points to the outer media span; a nested generation
result points to its child span. They share a trace when the composed call
propagates context. Provider-native media functions that bypass the core runner
do not make the guarantee.

Media assets themselves do not carry operation `_meta`. Asset provenance and
storage identity are durable domain concerns; the operation envelope and
observability lineage already connect the result to its production.

## Higher-level primitives

Higher-level primitives should integrate with the same contract. They are the
strongest reason to return the exact span rather than only a trace ID.

### Agents and compositions

Add required operation metadata to:

- `AgentResult`, produced by `agent.run`;
- `ParallelResult`, produced by `composition.parallel`;
- `PipelineResult`, produced by `composition.pipeline`;
- `ConsensusResult`, produced by `composition.consensus`;
- `SwarmResult`, produced by `composition.swarm`;
- `DelegateResult`, produced by `delegate.invoke`.

Nested `AgentResult` values retain their agent-span references inside a parent
composition result. The parent envelope receives the composition span. Dry-run,
empty, continue-on-error, and early-terminal paths need the same guarantee if
they return a success envelope.

Adapter-specific agent executors must not copy the underlying
`GenerateResult._meta` wholesale. The shared agent execution boundary stamps
the agent result after the executor returns. This keeps adapter implementations
portable and makes the abstraction boundary truthful.

Handoff payloads are validated domain data and do not automatically receive
metadata. A `DelegateResult` is an observed operation envelope and does.

### Durable flows

Every `FlowResult` variant receives required `_meta`:

- `completed` points to the `flow.run` span for that completion invocation;
- `suspended` points to the `flow.run` span that reached suspension;
- `cancelled` and `expired` point to the invocation that observed and returned
  the terminal state.

A resumed flow keeps its logical `runId` and W3C `traceId` through the stored
continuation, but opens a fresh segment and a fresh `flow.run` span. Therefore
the resumed `FlowResult` keeps the trace ID and uses the current invocation's
span ID. This is precisely why `segmentId` cannot appear in common result meta.

Persisted `FlowSnapshot` data should not store the result `_meta` as domain
output. It already stores the continuation/trace context needed to resume.
Runtime Engine result serialization must either reconstruct the current
invocation envelope or explicitly store a validated operation reference in a
versioned runtime field. The public contract may not accidentally replay a
stale suspension span as the result of a later resume.

Child flows and durable effects preserve their own result references. If they
run independently, causal edges are the source of truth rather than forced
trace equality.

### Scoring, compaction, and citations

These existing explicit envelopes should be correlated:

- `JudgeResult` -> `scoring.judge`;
- `CompactionResult` -> `compaction.run`;
- `CitationValidationResult` -> `citation.check`.

Their model helpers may be raw application-owned call ports. The outer Crux
primitive still has an explicit span and can stamp its own result without
requiring a managed nested generation.

Constraint and guardrail results are primarily internal policy decisions
nested inside generation. Their audits already become generation metadata and
observability artifacts. Do not expand issue #221 by placing operation metadata
on every internal check result. If the public standalone pipelines later need
navigation, return a deliberately observed envelope from that API rather than
changing the policy strategy return types.

## Repository-wide applicability matrix

The following matrix is the design rule for every canonical observability
family, including families not implemented in the first release.

| Family / primitive                                   | Current public return character                | Decision                                                                               |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `run`                                                | observability control handle / aggregate       | No common result meta; handles already expose IDs                                      |
| `generation.call`                                    | explicit `GenerateResult` envelope             | Required `_meta`                                                                       |
| `generation.stream`                                  | immediate handle + completion                  | Same required pair on both; not chunks                                                 |
| `media.*`                                            | completed operation envelope                   | Required `_meta` from common runner                                                    |
| `prompt.resolve`, `prompt.inspect`                   | resolved prompt / inspection data              | Eligible operation envelopes; add in a later explicit slice, never provider-authored   |
| `context.*`                                          | nested values and resolver internals           | No metadata on individual values; parent prompt/generation carries identity            |
| `agent.run`                                          | `AgentResult` envelope                         | Required `_meta`                                                                       |
| `composition.*`                                      | parallel/pipeline/consensus/swarm envelopes    | Required parent `_meta`; retain child metadata                                         |
| `flow.run`                                           | discriminated durable invocation result        | Required `_meta` per returned invocation                                               |
| `flow.step`, suspension markers                      | arbitrary user values / internal events        | Do not mutate values; link through flow trace                                          |
| `tool.call`, `tool.approval`                         | arbitrary user/protocol values                 | Do not mutate tool output; pass identity in tool context/evidence when needed          |
| `mcp.*`                                              | remote protocol results / handles              | Do not rewrite protocol payloads; use wrapper/context if exposed                       |
| `retrieval.retrieve/query`                           | bare `RetrieverHit[]`                          | Keep bare API; introduce detailed envelope only if demanded                            |
| `retrieval.recipe/pipeline`                          | hits plus existing recipe execution trace      | Detailed recipe result is eligible; keep recipe trace distinct from Crux trace         |
| `embedding.call`                                     | bare vector(s)                                 | Keep bare API; future `embedDetailed()` may return an envelope                         |
| `memory.read/write`                                  | values, IDs, records, or `void`                | Do not decorate durable data; detailed receipts are a separate API                     |
| `constraint.*`, `guardrail.*`                        | policy decisions/audits nested in generation   | No change to strategy values; parent result and artifacts carry correlation            |
| `routing.*`                                          | transparent model/result wrappers and receipts | Preserve producing result metadata; receipts stay distinct                             |
| `cache.lookup`                                       | transparent cached result                      | Strip stored IDs and stamp current operation                                           |
| `compaction.run`                                     | `CompactionResult` envelope                    | Required `_meta`                                                                       |
| `scoring.judge`                                      | `JudgeResult` envelope                         | Required `_meta`                                                                       |
| `citation.check`                                     | validation envelope                            | Required `_meta`                                                                       |
| `eval.*`                                             | aggregate over evaluation and case runs        | Explicit run/reference collection; no singular `_meta` claim                           |
| `handoff.prepare`                                    | validated/transformed domain payload           | No automatic metadata                                                                  |
| `delegate.invoke`                                    | `DelegateResult` envelope                      | Required `_meta`                                                                       |
| `plan.operation`, `task.operation`                   | durable records or long-lived command handles  | Do not attach ephemeral meta; add command receipts/detailed methods if needed          |
| `workspace.operation`                                | file/domain records, content, or `void`        | Do not contaminate records; future detailed operation receipt may wrap value           |
| `indexing.pipeline`                                  | index operation summary or bare chunks/counts  | `IndexResult`/dry-run envelopes eligible; bare chunk/count APIs stay bare              |
| `corpus.sync`                                        | aggregate operation summary                    | Required `_meta`; per-source progress events stay events                               |
| `ingest.parse`                                       | provider/parser payload and async load events  | Parser payload stays provider-owned; a core load-operation envelope may carry metadata |
| `skill.load`                                         | durable skill definition/session values        | Do not decorate definitions; expose operation receipt only if navigation is needed     |
| `security.warning`, `feedback.record`, `cost.record` | events/records                                 | Correlation belongs in event/record schema, not `_meta`                                |
| `runtime.*`, `defer.*`                               | kernel transitions, receipts, durable handles  | Use explicit run/continuation/receipt identity; do not force common result meta        |
| `custom.operation`                                   | user-defined arbitrary value                   | Offer an opt-in observed envelope helper; never mutate arbitrary user values           |

### Why bare APIs stay bare

Changing `embed(): Promise<number[]>` into an object, or adding properties to an
array returned by `retrieve()`, is both breaking and ergonomically poor.
Likewise, a `Plan`, `Task`, `WorkspaceFile`, `Skill`, or memory record is durable
domain state. Its shape should not depend on which request happened to read it.

When direct navigation is useful, use a named detailed API:

```ts
interface OperationValueResult<T> {
  readonly value: T
  readonly _meta: OperationResultMeta
}

embedDetailed(text): Promise<OperationValueResult<number[]>>
retrieveDetailed(query): Promise<OperationValueResult<RetrieverHit[]>>
```

This is a future pattern, not required by issue #221. Avoid a generic option
such as `{ metadata: true }` if it makes return types conditional and hard to
infer; a named method is usually clearer.

## Evals and multi-operation evidence

Current Eval V1 already uses the correct aggregate vocabulary. `EvalCell.runIds`
contains logical task-run IDs, while `CellAssertionOutcome.spanIds` contains
exact related spans when a matcher can identify them. A cell aggregates task,
assertion, and scorer evidence and therefore must not claim one cell-level
`OperationResultMeta`.

Managed AI tasks project a `StreamCompletion` into `EvalTaskExecutionEvidence`.
That response keeps the producing task operation's `_meta` and `runId` while
dropping provider `raw`. Exact-evidence reuse intentionally keeps the historical
response and `runIds`; a fresh execution records a fresh task run. Assertion
span IDs are evidence links, not W3C trace IDs.

The public Eval cell vocabulary needs no migration: its schemas already say
`runIds`, and Devtools already treats them as logical run links. The private
deployed-Eval result codec must advance to schema version 2, however, because
retained managed-task responses now require `_meta.traceId` and `_meta.spanId`.
Version 1 payloads fail closed at that strict host boundary instead of being
silently accepted without the new contract. Focused coverage must prove that
generate-task and stream-task projections preserve correlation and never rename
a run or span ID to `traceId`.

## Errors and failure correlation

Issue #221 concerns successful results. Do not convert provider or policy
errors into success envelopes merely to expose IDs.

For streaming, the immediate handle already gives the operation pair before a
completion failure. For non-streaming failures, observability records retain
the span, but application code currently needs ambient context, hooks, or error
classification to find it. A future `CruxOperationError` or non-enumerable
error correlation helper can address that consistently. It should be designed
separately because wrapping errors changes `instanceof`, identity, aggregate
errors, and provider compatibility.

`onError` hook correlation is a legitimate follow-up: it can receive an
operation reference as a separate hook argument without mutating the thrown
error. It is not required to land the success-result contract.

## Serialization and security

Operation metadata consists only of opaque identifiers. It must never include
captured prompts, provider payloads, user correlators, deployment data, or URLs.

The IDs are enumerable because ordinary logging and JSON API responses are a
core use case. This also means every persistence boundary must make an explicit
choice:

- ephemeral response serialization may include them;
- semantic/output/domain caches must omit or version them as specified;
- durable flow continuations use their existing validated propagation carrier;
- provider raw payloads must not be rewritten;
- logging/redaction systems may treat the IDs as safe correlation fields.

Runtime validation should use the existing W3C ID schemas where untrusted or
persisted data is read. Core-created values can use branded types directly.

## API examples

### Generation and Devtools link

```ts
const result = await generate(summarizePrompt, {
  model,
  input: { article },
});

const { traceId, spanId } = result._meta;
const href = `/runs/${traceId}?spanId=${spanId}`;
```

### Nested composition

```ts
const result = await pipeline({ id: "publish", context, steps });

result._meta.spanId; // composition.pipeline
result.results[0]._meta.spanId; // agent.run
result._meta.traceId === result.results[0]._meta.traceId;
```

### Provider response distinction

```ts
const result = await generate(prompt, options);

result._meta.responseId; // provider lookup
result._meta.traceId; // Crux trace lookup
result._meta.spanId; // exact Crux operation lookup
```

## Package propagation

The contract is owned by `@use-crux/core`; provider and framework packages
must not define parallel metadata types.

| Package                             | Effect                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@use-crux/core`                    | Owns types, stamping, primitive envelopes, cache rules, and observability semantics                                                                 |
| `@use-crux/ai`                      | Managed `generate()`/`stream()` and media bindings inherit core results; raw AI SDK helper ports do not                                             |
| `@use-crux/openai`                  | Managed generation and completed media inherit core results; provider `raw` remains untouched                                                       |
| `@use-crux/anthropic`               | Managed generation/stream results inherit the core contract                                                                                         |
| `@use-crux/google`                  | Managed generation and completed media inherit the core contract                                                                                    |
| `@use-crux/convex`                  | Upstream Convex Agent passthrough methods keep upstream return types; Crux-owned lifecycle/turn envelopes need an explicit wrapper or run reference |
| `@use-crux/ingest`                  | Parser `ParseResult` stays provider-authored; Crux load/corpus envelopes may carry core metadata                                                    |
| `@use-crux/react`, `@use-crux/next` | No new identity contract unless they expose a Crux operation envelope; preserve underlying core metadata                                            |
| `@use-crux/otel`                    | Delivery/export only; no operation result stamping                                                                                                  |
| Crux Local / Devtools               | Existing Eval views keep logical `runIds`; operation response metadata remains available to readers that retain the response                         |

The Convex distinction is important. `ConvexGenerateTextResult` and related
types are aliases of `@convex-dev/agent` methods, not core `GenerateResult`s.
Adding `_meta` to those aliases would claim ownership of an upstream result and
could conflict with its SDK. A Crux lifecycle wrapper can instead return a
separate observed envelope or operation receipt. Durable Convex swarm state
continues to use its propagation carrier; a per-turn public envelope may expose
the current action's pair if that API is deliberately revised.

Eval V1 needs no public cross-language identity migration for this issue. Its
durable cell schema, Runtime Bridge payloads, Local readers, and Devtools
consumers already use `runIds`; keep that vocabulary stable. The private
deployed-result codec is the narrow exception: bump it to schema version 2 and
require correlated managed-task responses wherever the bounded persistence
policy retains them.

## Current implementation seams

These are the primary files the implementation should touch or protect. The
list is intentionally concrete so the common concern does not drift into
provider-specific modules.

| Concern                       | Current seam                                                                                                                    | Required direction                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ID brands and span handle     | `core/src/observability/contract.ts`, `observe.ts`                                                                              | Reuse existing branded IDs and explicit open-span fields         |
| Public correlation contract   | new `core/src/observability/result-meta.ts`                                                                                     | Small types plus envelope helper; export from stable paths       |
| Generation orchestration      | `core/src/generation/orchestrate.ts`                                                                                            | Thread exact span pair through middleware finalization and hooks |
| Generation facts              | `core/src/generation/types.ts`, `result-meta.ts`                                                                                | Split provider/policy facts from core operation identity         |
| Public generate/stream shapes | `core/src/adapter/result-accumulator.ts`, `define-adapter-types.ts`, `define-executor.ts`                                       | Require correct metadata without provider ownership              |
| Stream lifecycle              | `core/src/adapter/result-stream.ts`, `generation/orchestrate-observability.ts`, `generation/stream-finalizer.ts`                | Same stable pair on handle and completion                        |
| Middleware composition        | `core/src/runtime/types.ts`, `runtime/merge-runtime.ts`                                                                         | Finalize every `next()` return and restamp the outer result      |
| Prompt hook typing            | `core/src/prompt/prompt-types.ts`                                                                                               | `onGenerate` receives final required generation metadata         |
| Semantic cache                | `core/src/cache/entry.ts`, `semantic-cache.ts`                                                                                  | Strip stored pair, finalize hit for middleware/current call      |
| Completed media               | `core/src/completed-operation/contracts.ts`, `adapter/completed-operation/{definition,lifecycle,runner,observability-graph}.ts` | Split payload/result and stamp once in shared runner             |
| Higher-level agents           | `core/src/agent/executor.ts`, composition result modules, `composition-runtime/execution.ts`, `delegate.ts`                     | Stamp the span owned by each abstraction                         |
| Durable flows                 | `core/src/flow/types.ts`, `scope.ts`, `runtime-engine.ts`, serialization boundary                                               | Current invocation pair on every result variant; no stale replay |
| Scoring/compaction/citations  | `core/src/scoring/judge.ts`, `compaction/summarize.ts`, `citations/resolve.ts`                                                  | Stamp their existing explicit envelopes                          |
| Index/corpus summaries        | `core/src/indexing/define-indexer.ts`, `define-corpus.ts`, `types.ts`                                                           | Correlate summaries, not bare chunks/counts or progress events   |
| Eval task evidence            | `ai/src/{eval-task,eval-stream-task}.ts`, `core/src/eval/internal/{task,types,observed-task}.ts`                                | Preserve correlated task responses; keep cell `runIds` aggregate |
| Local / Devtools Eval readers | existing Eval wire model and run-link rendering                                                                                 | Keep logical run navigation; do not fabricate trace IDs          |
| Devtools links                | Eval cell detail and run routing                                                                                                | Continue canonical logical-run navigation                        |

## Implementation structure and file-size guardrails

Keep the common concern small and observability-owned:

```text
packages/core/src/observability/
  result-meta.ts                 public types + small clone/stamp helper
  index.ts                       exports only

packages/core/src/generation/
  types.ts                       GenerationMeta / GenerateResultMeta
  orchestrate.ts                 one boundary call, no helper implementation
  orchestrate-observability.ts   captures stream operation reference

packages/core/src/adapter/
  result-accumulator.ts          public result types
  result-stream.ts               handle/completion propagation
  completed-operation/
    runner.ts                    one final stamp
    observability-graph.ts       exposes explicit span reference
```

`generation/orchestrate.ts` is already near 300 lines and
`adapter/define-adapter.ts` is also near 300. Do not add generic metadata
logic to either. `prompt/prompt-types.ts` is already over 300 lines; limit its
change to importing/referencing the final type. The existing adapter dialect
parity test is very large, so add focused correlation test files rather than
another large block there.

Higher-level slices should likewise add a focused boundary helper or reuse the
common stamp function. Do not create one repository-wide wrapper that hides
span ownership, lifecycle, and serialization choices.

Keep new tests split by concern rather than extending the existing very large
dialect-parity suite:

```text
packages/core/__tests__/generation/result-correlation.test.ts
packages/core/__tests__/generation/stream-correlation.test.ts
packages/core/__tests__/cache/result-correlation.test.ts
packages/core/__tests__/adapter/completed-operation-correlation.test.ts
packages/core/__tests__/agent/result-correlation.test.ts
packages/core/__tests__/flow/result-correlation.test.ts
packages/ai/__tests__/eval-task-observability.test.ts
```

Use existing conformance harnesses from these focused files where parity is the
behavior under test; do not duplicate provider fixtures.

## TDD rollout

Follow red-green-refactor vertically. Each slice begins with one public
behavior or compile-time contract, implements the smallest boundary change,
then refactors shared code. Do not write the entire suite before any code.

### Slice 1: shared contract and non-streaming generation

1. Add type tests proving a public `GenerateResult` requires branded
   `traceId`/`spanId`, preserves provider metadata, and rejects unbranded or
   missing operation metadata at authored boundaries.
2. Add a behavior test that captures emitted records and proves the returned
   pair equals the exact `generation.call` record.
3. Add the shared types/stamp helper and the minimal orchestration call.
4. Test text and structured output, frozen results, middleware replacement,
   `onGenerate` visibility, and no-ALS execution.

### Slice 2: cache correctness

1. Seed a cache entry containing deliberately stale/forged IDs.
2. Prove a cache hit omits the stored pair and returns the current call's pair.
3. Prove cache miss/write serialization does not persist operation identity.
4. Preserve provider/policy metadata and document `responseId` behavior.

### Slice 3: streaming parity

1. Prove the immediate handle and completion share the exact
   `generation.stream` pair.
2. Repeat for text and structured streaming and for both adapter dialects.
3. Cover provider completion, raw-stream terminal fallback, partial
   consumption, cancellation/error, late metadata, and no-ALS operation.
4. Prove chunks do not acquire per-chunk result metadata.

### Slice 4: completed multimodal operations

1. Add shared-runner conformance proving image, transcription, speech, and a
   synthetic future operation receive the common pair.
2. Prove provider validators operate on payloads without required Crux IDs.
3. Prove frozen payloads are cloned, metadata is preserved, and composed child
   calls share trace/differ in span.

### Slice 5: higher-level primitives

Add one tracer bullet through agent -> generation -> tool and one through
pipeline -> multiple agents. Assert same-trace/different-span ownership and
concurrent sibling isolation. Then apply the same boundary helper to parallel,
consensus, swarm, and delegate with focused dry-run/error-mode tests.

### Slice 6: durable flows

1. Prove completed and suspended results point to their current flow spans.
2. Suspend, serialize, resume in a fresh segment, and prove trace stability,
   fresh span identity, and no stale metadata replay.
3. Cover Runtime Engine and record-store paths plus cancelled/expired results.

### Slice 7: scoring, compaction, citations, and indexing summaries

Add focused public tests for each explicit envelope. Avoid changing raw model,
parser, vector, domain-record, and strategy return ports.

### Slice 8: Eval evidence integration

1. Write red tests proving managed generate and stream task responses retain
   `_meta` and `runId` after provider `raw` is removed.
2. Prove `EvalCell.runIds` continues to contain logical run IDs and assertion
   outcomes continue to expose exact span IDs independently.
3. Keep the public Eval persistence, Local, and Devtools schemas unchanged.
   Advance the strict private deployed-result codec to schema version 2 and
   require correlated managed-task responses at that boundary.

### Cross-cutting test requirements

- capture actual emitted span records; do not merely assert ID string shapes;
- test nested, concurrent, routed, cached, and no-ALS paths;
- use public result types in compile-time tests;
- test clone/prototype/frozen-object behavior directly;
- test serializers so ephemeral IDs cannot silently persist;
- assert parent and child span ownership, not only trace equality.

## Documentation plan

Update:

- generation result reference and prompt hook docs;
- streaming lifecycle/reference docs;
- completed media operation docs and examples;
- agent/composition and durable flow result references;
- observability identity documentation with a trace/span/run/segment table;
- Eval docs to distinguish cell `runIds`, response operation metadata, and
  assertion span evidence;
- adapter author docs explaining provider payload versus core-finalized result;
- migration notes for the `TraceMeta` deprecation and any newly required
  `_meta` fields.

Examples should show direct lookup and nested ownership. Avoid teaching users
to concatenate URLs when a shared Devtools-link helper later exists; issue #221
does not need that helper to ship.

## Compatibility and release strategy

Adding fields at runtime is compatible for ordinary object consumers, but
making `_meta` required and splitting provider payload types affects TypeScript
adapter authors. Treat the initial cross-Crux contract as a public minor
feature while preserving source compatibility where practical:

- retain `TraceMeta` as a deprecated alias for one release cycle;
- keep provider-facing payload types free of required Crux IDs;
- export branded IDs and the common metadata type from stable subpaths;
- do not change bare-value API return shapes;
- keep the existing Eval V1 `runIds` wire vocabulary unchanged;
- update an existing observability-themed pending changeset if one still
  describes the release, rather than creating a duplicate changeset.

The design document itself needs no changeset. Implementation affecting npm
users does.

## Non-goals

- exposing full prompts, spans, records, or Devtools URLs in every result;
- treating provider response IDs as Crux trace IDs;
- adding `segmentId` to public results;
- mutating arbitrary tool, retrieval, memory, embedding, workspace, plan, task,
  skill, or custom-operation values;
- wrapping provider errors as success results;
- making `@use-crux/core` depend on a provider SDK, framework, or Devtools UI;
- persisting invocation-local correlation in semantic/domain caches;
- inventing trace continuity for detached work;
- solving every detailed/receipt API in the first issue.

## Acceptance criteria

The design is implemented correctly when:

1. every documented operation envelope exposes a branded trace/span pair that
   resolves to the exact producing Crux span;
2. parent and child envelopes share traces when context propagates and retain
   distinct owning spans;
3. streaming exposes stable identity immediately and at completion;
4. cache hits never replay stale operation identity;
5. providers create payload facts while core alone assigns operation identity;
6. frozen results, middleware replacement, routing, retries, and no-ALS
   runtimes preserve the guarantee;
7. durable resume uses the current invocation span without storing a stale
   segment identity;
8. Eval evidence keeps logical run IDs, operation metadata, and assertion span IDs distinct;
9. bare values and durable records retain their existing ergonomic shapes;
10. public JSDoc explains ownership, timing, and provider-ID distinction.

## Open implementation decisions

These choices can be settled during the relevant red test without changing the
architecture:

- whether `WithOperationResultMeta` is public or remains an internal type
  utility behind explicit public result interfaces;
- the exact one-release deprecation schedule for `TraceMeta`;
- whether prompt `resolve()`/`inspect()` correlation lands in the first broad
  release or a follow-up slice;
- whether a future Devtools-link helper belongs in core observability or a
  Devtools integration package.

The following are not open: the common pair is trace + exact span; providers do
not own it; segment ID is excluded; caches cannot replay it; parents own their
own span; and aggregates cannot masquerade as a single operation.
