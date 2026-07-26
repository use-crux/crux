---
"@use-crux/core": minor
"@use-crux/ai": minor
"@use-crux/openai": minor
"@use-crux/anthropic": minor
"@use-crux/google": minor
"@use-crux/indexer": minor
"@use-crux/devtools": patch
"@use-crux/local": minor
---
Normalize structured response and tool-input schemas through provider capability
profiles. Crux now compiles provider-compatible wire schemas, decodes transport
sentinels before Safety, validates once with the authored schema, and exposes the
parsed output consistently across native, AI SDK, generate, and stream routes.

Structured outputs are now always validated. `validationRetry` controls whether
another attempt is made; without it, invalid structured output throws instead of
being returned. Adapter authors must declare their structured-output
capabilities and use the prepared `outputSchema` supplied to request builders.
AI SDK and provider adapters now accept `@use-crux/mcp` 0.7 peers.

## Provider-neutral media classification

Add `guardrail.mediaClassifier()` for per-part image, audio, video, and
file/document classification through any `GenerateObjectFn`. Caller-authored
categories, inclusive thresholds, capability handling, input/output media
boundaries, report mode, and strip escalation share one provider-neutral
contract.

`GenerateObjectFn` now accepts either a text prompt or canonical messages so
structured media reaches provider adapters without flattening. Native OpenAI,
Anthropic, and Google object helpers bind only their client; callers pass the
model per invocation. Existing two-argument helper construction must migrate
to `createGenerateObjectFn(client)` plus `{ model, ... }` on each call.

Guardrail findings now survive callback collection into audits, terminal
decisions, privacy-safe report artifacts, and Devtools Run Detail. Project
Index and Catalog expose only complete literal classifier-safe configuration;
telemetry retains bounded counts rather than category or media details.

## Boundary-driven streaming Safety

An `assert` constraint is transactional on a stream: it gates release, and a failed
attempt is discarded without publishing bytes and re-streamed with corrective feedback
under the shared `maxSteps` budget. A positive `validationRetry.maxRetries` installs the
same commit gate for schema validation. Buffering is attributable through a content-free
`bufferedBy` reason and `generation.stream.attempt` spans, and constraint settlement is
occurrence- and value-precise, so a settled `constraint.judge()` is not re-run at
completion.

Streaming Safety holds an occurrence until every downstream transformation that could
change it has completed: an object assertion that passes while a text guard can still
rewrite the represented JSON is provisional and cannot release bytes, and it is
re-evaluated against the final value before anything is published. Object-only pipelines
keep progressive release.

`stream()` on `@use-crux/ai` now honors `validationRetry`, which it previously discarded.
Adapters report the model steps an SDK invocation actually consumed while core enforces
the shared `maxSteps` budget; when consumption is unknown or settled tool rounds cannot be
resumed safely, Crux fails closed instead of risking duplicate tool side effects.

Rejected candidates are evidence-only on public terminal errors: `ValidationExhaustedError`
and `ConstraintViolationError` expose size and hash, never a preview of output the caller
was not allowed to see. Constraint feedback and metadata no longer reach telemetry (only a
feedback length and a metadata count), and `ValidationExhaustedError` no longer exposes
custom Zod issue messages or model-controlled record keys — use its new `issues` summary
for stable `{ path, depth, code }` diagnostics.

Structured-output compilation fails closed rather than risking silent corruption: an
optional property is rejected at compile time when its encoding cannot be proven
reversible — inside a recursive schema, a union branch, an intersection or tuple, or when
the property is literally named `"*"`.

## Managed logical streams

`stream()` now returns one Crux-owned logical stream with the same shape on every route:
`{ runId, _meta, textStream, fullStream, partialOutputStream, completion, cancel }`. A
logical stream may use several physical provider attempts, but provider framing, discarded
attempts, and the provider stream object are never observable. All three streams project
one shared append-only event log, so they can be read concurrently, a surface first read
late replays from logical `start`, and retention never delays publication — `completion`
settles without any stream being drained. A terminal failure now reaches every surface with
the same normalized error object rather than only rejecting `completion`.
`result.cancel(reason?)` aborts the whole operation, including the active provider attempt.

For a structured prompt, `textStream` carries canonical serialized `z.input` JSON, and
`partialOutputStream` is a parsed projection of that same published text — so a partial can
only ever describe committed output. `completion.object` remains the single
authored-schema-validated `z.output`.

Logical `usage` and `cost` are scalar aggregates across every BILLABLE physical attempt,
discarded ones included — the caller paid for each provider call. Everything else in the
envelope still describes the accepted attempt alone, so logical `usage` deliberately stops
equalling the sum of `steps[].usage` once a policy retry occurred. If any billable attempt
did not report a figure the total is omitted rather than under-reported; on the AI SDK route
a rejected attempt reports no usage at all, so a retried SDK stream omits logical usage.

The local runtime accepts the new `generation.stream.attempt` primitive, so coordinated
streams keep their buffering attribution in Devtools instead of being dropped as unknown.

`onChunk`, `onFinish`, and `onError` are logical: they observe the published sequence and
the logical completion, and no caller callback is installed on a physical attempt, so a
discarded attempt invokes none of them. `@use-crux/ai` adds `toUIMessageStream(result)` and
`createTextStreamResponse(result)`, and its existing UI-message helpers are now built from
`fullStream`, which makes a discarded attempt unrepresentable in their input.

## Breaking removals

Streamed `result.raw` is removed on every adapter. A provider stream resolves before
terminal Safety and describes only one attempt, so exposing it bypassed guardrail holds,
structured occurrence gating, commit gates, and validation retry. Provider-specific request
options are unchanged, and provider-specific terminal facts remain on
`completion.providerMetadata`. Replace `result.raw.partialObjectStream` with
`result.partialOutputStream`, `result.raw.fullStream` with `result.fullStream`, and
`result.raw.toUIMessageStream(...)` with `toUIMessageStream(result)`. `generate()` results
keep `.raw` unchanged. The public `StreamResult` type parameters change from
`StreamResult<TRawStream, TOutput>` to `StreamResult<TOutput, TPartial>`, and the
`TextStreamResult`/`ObjectStreamResult` aliases are removed.

Guardrail streaming configuration moved onto the boundary: `GuardrailConfig.stream`, the
`stream` tune field, `ConstraintConfig.onChunk`, and `onHoldLimit: 'release'` are removed in
favor of
`boundary.output.text().sentences() | .lines() | .deltas() | .complete() | .segments()`.
The curried `boundary.output.path<T>()('a.b')` spelling is replaced by
`boundary.output.object<T>().path('a.b')`.
