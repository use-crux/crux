# @use-crux/core/observability

Canonical Crux observability graph contract.

This package owns the TypeScript source of truth for graph records emitted by Crux runtimes and ingested by devtools backends.

## Field-Change Checklist

When changing a graph field, update all of these in the same slice:

1. Public TypeScript type in `contract.ts`.
2. Runtime schema in `schema.ts`.
3. Shared fixture in `fixtures/`.
4. TypeScript contract tests in `__tests__/observability/`.
5. Type-level checks in `__type_tests__/` when the change affects type safety.
6. Go mirror structs/tests in `packages/local/internal/observability`.
7. Relevant ADR or docs if the change alters semantics.

Do not add mandatory code generation. TS and Go stay aligned through this checklist plus shared fixtures.

## Namespaces

Built-in edge types and artifact kinds are closed canonical lists. User-defined edge types and artifact kinds must use the `custom.*` namespace so backend read models and UI layouts can distinguish supported semantics from app-specific payloads.

## Identity And Ordering

`createCruxTraceId()` returns a W3C trace ID: 32 lowercase hexadecimal characters, never all zeroes. `createCruxSpanId()` returns a W3C span ID: 16 lowercase hexadecimal characters, never all zeroes.

Run, record, event, edge, and artifact IDs keep Crux prefixes with crypto-random hex suffixes. Every graph record includes `seq`, a per-run monotonic number assigned at emit time and used by local storage/read paths for deterministic raw-record ordering.

## Generation Metrics

Generation terminal span records use the existing `metrics` field for client-side performance values:

- `gen.duration_ms`
- `gen.time_to_first_token_ms`
- `gen.output_tokens_per_second`
- `gen.time_per_output_chunk_ms`

These keys do not change the graph shape and do not require a schema-version bump.

## Capture Policy

`config({ observability: { recordInputs, recordOutputs, redactRecord } })` controls payload capture before records reach subscribers, the diagnostics channel, transports, or OTel. `recordInputs` and `recordOutputs` accept `true | false | 'inline' | 'reference' | 'off'`; booleans are sugar for `true -> 'inline'` and `false -> 'reference'`.

`'inline'` keeps previews, `'reference'` emits `encoding: 'reference'` with `sizeBytes` and `hash`, and `'off'` omits preview, size, hash, and URI metadata. Disabled directions also strip known payload attribute keys such as `text`, `query`, `prompt`, `messages`, `input`, `output`, `preview`, `content`, `delta`, `body`, and `filter` from span, event, artifact, run, and edge attributes.

`redactRecord(record)` runs after capture modes and before sanitization. Return a replacement record to redact in place, or `null` to drop it. Hook errors fail closed: the record is dropped and counted in `observabilityDiagnostics().redactedRecords`.

## Transport Delivery

`CruxObservabilityTransport.send()` is an at-least-once delivery boundary. Transports must be idempotent by `recordId`; the delivery engine may retry failed chunks while preserving chunks that were already accepted.

The engine owns batching and request chunking. `observability.delivery.scheduledDelayMs` controls the batching window, `observability.delivery.maxBatchSize` bounds each engine batch, and `transport.maxRecordsPerRequest` bounds each `send()` call. `observe.flush()` drains queued records and calls an optional transport `flush()` hook. `observe.shutdown()` drains queued records, calls optional `shutdown()`, and then disables the transport.
