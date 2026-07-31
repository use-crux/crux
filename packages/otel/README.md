# @use-crux/otel

OpenTelemetry integration for Crux. Emits OTel spans for every instrumented Crux event — generate, stream, tools, flows, compositions, memory, compaction, scoring, and more.

## Install

```bash
pnpm add @use-crux/otel @use-crux/core
```

`@opentelemetry/api` is an optional peer dependency — only needed for the standard OTel `TracerProvider` path (see below).

## Quick Start

```ts
import { config } from '@use-crux/core'
import { createCruxResourceAttributes, withTelemetry } from '@use-crux/otel'

config({
  prompts,
  plugins: [withTelemetry({ serviceName: 'my-app' })],
})
```

`withTelemetry()` projects spans from the canonical
`@use-crux/core/observability` graph stream. OTel, devtools, user subscribers,
and diagnostics-channel consumers all observe the same event spine.

## Export Paths

`@use-crux/otel` supports two export strategies:

### Standard OTel (Node.js servers)

When no `exporter` is configured, spans flow through the globally registered OTel `TracerProvider`. You set up the OTel SDK once in your application entrypoint:

```ts
// instrumentation.ts (your code)
import { NodeSDK } from '@opentelemetry/sdk-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { config } from '@use-crux/core'
import type { CruxDeploymentIdentity } from '@use-crux/core/project-index'
import { createCruxResourceAttributes, withTelemetry } from '@use-crux/otel'

const identity = {
  projectId: 'checkout',
  manifestId: 'pim_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  deploymentId: 'production-42',
} satisfies CruxDeploymentIdentity

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    ...createCruxResourceAttributes(identity),
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'https://otel-collector.example.com/v1/traces',
  }),
})
sdk.start()

config({
  observability: { identity },
  plugins: [withTelemetry({ serviceName: 'my-app' })],
})
```

Then `@use-crux/otel` spans automatically appear in Datadog, Honeycomb, Grafana, etc.
The application owns this immutable Resource and must construct it before
`NodeSDK.start()`. `withTelemetry()` never replaces the provider or mutates or
inspects SDK-private Resource state after registration.

### Lightweight (Lambda, Convex, Cloudflare Workers)

For ephemeral runtimes where the full OTel SDK isn't available:

```ts
// URL exporter — HTTP POST, fire-and-forget
withTelemetry({
  serviceName: 'my-app',
  exporter: { url: 'https://collector.example.com/v1/traces' },
})

// Callback exporter — custom handling
withTelemetry({
  serviceName: 'my-app',
  exporter: (spans) => sendTelemetry(spans),
})
```

The lightweight path uses internal `TraceSpan` objects instead of the OTel SDK. `@opentelemetry/api` is an optional peer dependency — only needed for the standard path.
When `observability.identity` is configured, lightweight exporters carry the
same `crux.project.id`, `crux.manifest.id`, and `crux.deployment.id` values on
every root and child span because they have no separate Resource object.

## Runtime Safety

`withTelemetry()` is guarded against duplicate installation. If the plugin is installed twice in the same process, the second install warns once and becomes a no-op so traces are not exported twice.

Span registries are bounded and lazily swept. Open run/span references and active span managers cap in-memory entries and force-end evicted spans with `crux.expired: true` and `UNSET` status instead of growing without bound.

If the standard OTel path is selected but no `TracerProvider` is registered, Crux detects the invalid OTel span context, warns once, and falls back to the lightweight manager. Register a provider before installing `withTelemetry()` or pass an explicit `exporter` option.

## Spans

Every instrumented Crux event produces a span:

| Event                     | Span Name                       | Key Attributes                                                                                                  |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `generate()` / `stream()` | `chat {model}`                  | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.client.operation.duration`, `gen_ai.server.time_to_first_token`, `crux.cost` |
| Tool execution            | `execute_tool {name}`           | `gen_ai.operation.name`, `crux.tool.name`, `crux.tool.call_id`, `crux.tool.model_output.type`, `crux.tool.output.size`, `crux.tool.model_output.size`, `crux.tool.token_savings_estimate`, `crux.tool.estimated` |
| `flow().run()`            | `invoke_workflow {name}`        | `gen_ai.operation.name`, `crux.flow.id`, `crux.flow.name`, `crux.flow.parent_id`                                |
| `flow.step()`             | `crux.flow.step`                | `crux.step.id`, `crux.step.label`                                                                               |
| `flow.suspension` primitive | `crux.flow.suspension`        | intentional-wait marker linked to the causing step (recorded automatically, not a method you call)              |
| Compositions              | `crux.composition.{kind}`       | `crux.composition.kind`, `crux.composition.agent_count`                                                         |
| Agent in composition      | `crux.composition.agent.{id}`   | `crux.composition.id`                                                                                           |
| Memory read               | `crux.memory.read`              | `crux.memory.type`, `crux.memory.operation`                                                                     |
| Memory write              | `crux.memory.write`             | `crux.memory.type`, `crux.memory.operation`                                                                     |
| Compaction                | `crux.compact`                  | `crux.compaction.ratio`                                                                                         |
| Judge score               | `crux.judge`                    | `crux.judge.metric`, `crux.judge.score`                                                                         |
| Delegation                | `crux.delegate`                 | `crux.delegate.id`                                                                                              |
| Suspend                   | ends the segment's root span (status `OK`) | `crux.run.suspended`, `crux.run.suspend_reason`                                                      |
| Resume                    | fresh root span, same `traceId` | `crux.run.resumed`, `crux.run.previous_segment_id`                                                              |

`run:suspend` ends the current execution segment's root OTel span; it never stays open across a
physical suspension boundary. `run:resume` always starts a brand-new root span rather than reopening
the suspended one — that new span shares the original Crux `traceId` (real remote-parent correlation
when no local parent span is found) so the suspend and resume spans are visibly the same distributed
trace even though they are two separate SDK spans in two separate processes.

Generate/stream spans follow the pinned `genai-dev-2026-06` GenAI semantic convention table.
Crux generation span metrics are projected from the canonical graph metrics into seconds-based
GenAI attributes such as `gen_ai.client.operation.duration` and `gen_ai.server.time_to_first_token`
so custom subscribers, devtools, and OTel see one source of truth.

Tool spans intentionally record only shape and size metadata for `toModelOutput()` conversions. Raw tool output and model-facing tool output are not emitted to OTel.

Validated DefinitionRefs map the primary authored definition to
`crux.definition.id`, `.kind`, and `.role`. Up to 16 ordered
`crux.definition.ref` events retain safe source locations; total reference text
is capped at 8 KiB per span and reports truncation without exporting content.

### Execution evidence events

Qualified execution evidence uses dedicated events and never falls through the
generic `crux.edge` or span-event projections.

`crux.evidence` has this complete positive allowlist:

- `crux.evidence.id`
- `crux.evidence.role`
- `crux.evidence.kind`
- `crux.evidence.conclusion` when present
- `crux.evidence.subject_kind`

Canonical evidence kinds retain their closed value. Application-authored
`custom.*` kinds export only `custom`. `crux.evidence.id` is an opaque
relationship identifier intended only for exact event correlation with Crux
Local and delivery diagnostics. Never promote it to a span or Resource
attribute and never use it as a metric dimension.

Explicit coverage emits `crux.evidence.coverage` with only role and
`crux.evidence.coverage_status`. Same-scope coverage disagreement emits
`crux.evidence.coverage.conflict` with only role.

The negative allowlist excludes inline evidence, previews, source and subject
IDs, edge endpoints, raw resources and paths, recovery envelopes, raw or
hashed idempotency keys, content digests, evidence-source markers,
supersession IDs, capture/payload state, payload-unavailability metadata,
terminal-acceptance metadata, producer attributes, caller/record timestamps,
raw custom kinds, and arbitrary current or future qualified fields. Producer
identity is used only to choose the owning OTel span; it is not exported as an
event attribute. A malformed record or unresolved producer is omitted without
falling back to the evidence source or subject.

## Options

```ts
interface TelemetryOptions {
  /** Service name for span identification. @default '@use-crux/otel' */
  serviceName?: string

  /** Custom attributes added to every span. */
  attributes?: Record<string, string>

  /** Export strategy. Omit for standard OTel TracerProvider path. */
  exporter?: UrlExporter | CallbackExporter

  /** Opt into GenAI message-content attributes. Default: false. */
  captureMessageContent?: boolean

  /** Forward compatibility knob for the pinned table. */
  semconvVersion?: typeof SEMCONV_VERSION

  /**
   * Baggage member keys (from an extracted W3C `baggage` header, or a Flow/Convex
   * resume carrier) copied onto the resumed root span as `crux.baggage.<key>`
   * attributes. Unset by default — baggage is untrusted input and nothing is
   * copied unless explicitly allowlisted.
   */
  baggageAttributeAllowlist?: readonly string[]
}
```

Payload capture is configured centrally on the canonical graph stream with
`config({ observability: { recordInputs, recordOutputs, redactRecord } })`.
`recordInputs` and `recordOutputs` accept `inline`, `reference`, or `off`
capture modes. `@use-crux/otel` projects metadata from those graph records and
also drops known payload attribute keys such as `text`, `query`, `messages`,
`output`, `body`, and `filter` by default as defense in depth.

OTel message content is disabled by default even when local graph capture is
inline. Set `captureMessageContent: true` or
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` to export
`gen_ai.input.messages`, `gen_ai.output.messages`, and
`gen_ai.system_instructions` from generation artifacts, capped at 32KB each.

## Active execution bridge and propagation

`withTelemetry()` makes the SDK span active around the real instrumented callback — `trace.getActiveSpan()`
resolves correctly inside provider/tool/agent/flow work and nested spans parent correctly — rather than
creating a span only after the work has already run. Resumed segments do not reuse an OTel span object
across a suspension boundary: `run:suspend` ends the current segment's root span, and `run:resume` starts
a new root span that shares the original Crux `traceId` for a real (not merely correlated-by-attribute)
distributed-trace link.

`injectCruxPropagationCarrier()` / `extractCruxPropagationCarrier()` round-trip the same
`CruxPropagationCarrier` Flow/Convex use for in-process resume through standard W3C `traceparent` /
`tracestate` headers, so a custom queue or RPC boundary can propagate trace correlation across a real
wire hop without sharing memory. Incoming carriers are untrusted: format/length limits and baggage caps
are enforced, and baggage keys only become `crux.baggage.*` span attributes when explicitly named in
`baggageAttributeAllowlist`.

`observe.flush()` / `observe.shutdown()` (and the `@use-crux/core/observability` host-lifecycle
wrappers) force-flush the installed telemetry manager's exporter/processor work, not only the delivery
queue: the lightweight manager tracks in-flight `exporter.export()` promises, and the standard OTel path
calls through to the registered `TracerProvider`'s own `forceFlush()`. Both are bounded by the caller's
deadline and, on a host that exposes one (Workers `waitUntil`, a serverless wrapper's remaining-time
budget), registered with that host's lifecycle instead of blocking the return path.

## Coexistence with Devtools

Both devtools and OTel can run simultaneously. The plugin system's fan-out semantics ensure both receive every event:

```ts
import { withTelemetry } from '@use-crux/otel'
import { config } from '@use-crux/core'

config({
  observability: {
    serverUrl: process.env.DEVTOOLS_URL,
    token: process.env.CRUX_DEVTOOLS_TOKEN,
  },
  plugins: [withTelemetry({ serviceName: 'my-app' })],
})
```

Public docs: production telemetry guide under `apps/docs` (`guides/observability/telemetry`), plus privacy and runtime-setup pages for capture policy and host flush wrappers.

## Architecture

`@use-crux/otel` is a pure subscriber to `@use-crux/core`'s observability graph:

- **`withTelemetry()`** returns a `CruxPlugin` with name `'crux:otel'`
- **`withTelemetry()`** subscribes to the canonical observability graph stream
- **`createOtelRecordSubscriber()`** maps graph records to span lifecycle calls, including `run:suspend` (ends the segment root span) and `run:resume` (fresh root span, same `traceId`)
- **`SpanManager`** abstracts span lifecycle over both OTel tracer and lightweight `TraceSpan` tracking, and exposes `runActive()` (activate a span around a callback) and a bounded, deadline-aware `forceFlush()`
- **`propagation.ts`** implements `injectCruxPropagationCarrier()` / `extractCruxPropagationCarrier()` and the baggage-attribute allowlist projection
- **Exporters**: `createUrlExporter()` (HTTP POST) and `createCallbackExporter()` (user function)

The lightweight exporter path uses Crux W3C trace/span IDs directly for exported `TraceSpan` objects. The standard OTel provider path keeps provider-issued span context and records Crux IDs as attributes for correlation.
