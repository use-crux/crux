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
import { withTelemetry } from '@use-crux/otel'

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
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'https://otel-collector.example.com/v1/traces',
  }),
})
sdk.start()
```

Then `@use-crux/otel` spans automatically appear in Datadog, Honeycomb, Grafana, etc.

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
  exporter: (spans) => ctx.runAction(sendTraces, { spans }),
})
```

The lightweight path uses internal `TraceSpan` objects instead of the OTel SDK. `@opentelemetry/api` is an optional peer dependency — only needed for the standard path.

## Runtime Safety

`withTelemetry()` is guarded against duplicate installation. If the plugin is installed twice in the same process, the second install warns once and becomes a no-op so traces are not exported twice.

Span registries are bounded and lazily swept. Open run/span references and active span managers cap in-memory entries and force-end evicted spans with `crux.expired: true` and `UNSET` status instead of growing without bound.

If the standard OTel path is selected but no `TracerProvider` is registered, Crux detects the invalid OTel span context, warns once, and falls back to the lightweight manager. Register a provider before installing `withTelemetry()` or pass an explicit `exporter` option.

## Spans

Every instrumented Crux event produces a span:

| Event                     | Span Name                       | Key Attributes                                                                                                  |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `generate()` / `stream()` | `crux.generate`                 | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.client.duration_ms`, `gen_ai.client.time_to_first_token_ms`, `gen_ai.client.output_tokens_per_second`, `gen_ai.client.time_per_output_chunk_ms`, `crux.cost` |
| Tool execution            | `crux.tool.{name}`              | `crux.tool.name`, `crux.tool.call_id`, `crux.tool.model_output.type`, `crux.tool.output.size`, `crux.tool.model_output.size`, `crux.tool.token_savings_estimate`, `crux.tool.estimated` |
| `flow().run()`            | `crux.flow`                     | `crux.flow.id`, `crux.flow.name`, `crux.flow.parent_id`                                                         |
| `flow.step()`             | `crux.flow.step`                | `crux.step.id`, `crux.step.label`                                                                               |
| `flow.suspend()`          | Event on `crux.flow` + span end | `crux.flow.suspend_point`                                                                                       |
| Resume                    | `crux.flow.resume`              | `crux.flow.id`, `crux.flow.name` (fresh span, correlated by flow ID)                                            |
| Compositions              | `crux.composition.{kind}`       | `crux.composition.kind`, `crux.composition.agent_count`                                                         |
| Agent in composition      | `crux.composition.agent.{id}`   | `crux.composition.id`                                                                                           |
| Memory read               | `crux.memory.read`              | `crux.memory.type`, `crux.memory.operation`                                                                     |
| Memory write              | `crux.memory.write`             | `crux.memory.type`, `crux.memory.operation`                                                                     |
| Compaction                | `crux.compact`                  | `crux.compaction.ratio`                                                                                         |
| Judge score               | `crux.judge`                    | `crux.judge.metric`, `crux.judge.score`                                                                         |
| Delegation                | `crux.delegate`                 | `crux.delegate.id`                                                                                              |

Generate/stream spans follow the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).
Crux generation span metrics are projected from the canonical graph metrics into `gen_ai.client.*`
attributes so custom subscribers, devtools, and OTel see one source of truth.

Tool spans intentionally record only shape and size metadata for `toModelOutput()` conversions. Raw tool output and model-facing tool output are not emitted to OTel.

## Options

```ts
interface TelemetryOptions {
  /** Service name for span identification. @default '@use-crux/otel' */
  serviceName?: string

  /** Custom attributes added to every span. */
  attributes?: Record<string, string>

  /** Export strategy. Omit for standard OTel TracerProvider path. */
  exporter?: UrlExporter | CallbackExporter
}
```

Payload capture is configured centrally on the canonical graph stream with
`config({ observability: { recordInputs, recordOutputs, redactRecord } })`.
`recordInputs` and `recordOutputs` accept `inline`, `reference`, or `off`
capture modes. `@use-crux/otel` projects metadata from those graph records and
also drops known payload attribute keys such as `text`, `query`, `messages`,
`output`, `body`, and `filter` by default as defense in depth.

## Coexistence with Devtools

Both devtools and OTel can run simultaneously. The plugin system's fan-out semantics ensure both receive every event:

```ts
import { withDevtools } from '@use-crux/core/observability'
import { withTelemetry } from '@use-crux/otel'

config({
  prompts,
  plugins: [withDevtools({ serverUrl: process.env.DEVTOOLS_URL }), withTelemetry({ serviceName: 'my-app' })],
})
```

## Architecture

`@use-crux/otel` is a pure subscriber to `@use-crux/core`'s observability graph:

- **`withTelemetry()`** returns a `CruxPlugin` with name `'crux:otel'`
- **`withTelemetry()`** subscribes to the canonical observability graph stream
- **`createOtelRecordSubscriber()`** maps graph records to span lifecycle calls
- **`SpanManager`** abstracts span lifecycle over both OTel tracer and lightweight `TraceSpan` tracking
- **Exporters**: `createUrlExporter()` (HTTP POST) and `createCallbackExporter()` (user function)

The lightweight exporter path uses Crux W3C trace/span IDs directly for exported `TraceSpan` objects. The standard OTel provider path keeps provider-issued span context and records Crux IDs as attributes for correlation.
