# @use-crux/core/observability

Canonical Crux observability graph contract.

This package owns the TypeScript source of truth for graph records emitted by Crux runtimes and ingested by devtools backends.

## Schema Versioning

Schema bump rules, additive-field policy, forward-compat behavior, and the TS/Go field-change checklist live in [VERSIONING.md](./VERSIONING.md). Do not add mandatory code generation. TS and Go stay aligned through that checklist plus the shared fixture corpus in `fixtures/`.

## Namespaces

Built-in edge types and artifact kinds are closed canonical lists. User-defined edge types and artifact kinds must use the `custom.*` namespace so backend read models and UI layouts can distinguish supported semantics from app-specific payloads.

## Identity And Ordering

`createCruxTraceId()` returns a W3C trace ID: 32 lowercase hexadecimal characters, never all zeroes. `createCruxSpanId()` returns a W3C span ID: 16 lowercase hexadecimal characters, never all zeroes.

Operation, run, segment, record, event, edge, and artifact IDs keep Crux prefixes with crypto-random hex suffixes. Every graph record includes `operationId`. The root has `operationId === runId`; independently durable descendants get a distinct `runId`, retain the root operation ID, and declare immutable `parentRunId` plus `triggeredBySpanId` topology. A propagated host continuation stays in the same run and opens a fresh segment. `traceId` remains W3C correlation and is never used to infer operation membership.

Every graph record also includes `segmentId` plus a positive `segmentSeq`; the sequence is monotonic only inside that execution segment.

`config({ observability: { identity } })` captures a validated project,
manifest, and optional host deployment identity when a logical run starts.
Every v5 record for that run carries the same immutable `deployment` value,
including records emitted after configuration changes or suspend/resume. The
owned continuation payload preserves it separately from untrusted W3C baggage.

## Generation Metrics

Generation terminal span records use the existing `metrics` field for client-side performance values:

- `gen.duration_ms`
- `gen.time_to_first_token_ms`
- `gen.output_tokens_per_second`
- `gen.time_per_output_chunk_ms`

These keys do not change the graph shape and do not require a schema-version bump.
Custom metric keys must use the `custom.*` namespace. Span families are derived from canonical primitive names at emit time, so public span options do not accept a separate `family` field.

## Correlators

`propagateAttributes({ sessionId, userId, metadata }, fn)` attaches logical correlators to every graph record emitted while `fn` runs. Nested scopes merge shallowly; inner `sessionId`, `userId`, and metadata keys win.

`sessionId` and `userId` are top-level graph fields. Metadata is projected into attributes as `meta.<key>` strings capped at 200 characters. `configureObservability({ defaultCorrelators })` applies the same fields when no active scope provides correlators; devtools passes `EnableDevtoolsOptions.sessionId` through this default path.

## Capture Policy

`config({ observability: { recordInputs, recordOutputs, redactRecord } })` controls payload capture before records reach subscribers, the diagnostics channel, transports, or OTel. `recordInputs` and `recordOutputs` accept `true | false | 'inline' | 'reference' | 'off'`; booleans are sugar for `true -> 'inline'` and `false -> 'reference'`.

`'inline'` keeps previews, `'reference'` emits `encoding: 'reference'` with `sizeBytes` and `hash`, and `'off'` omits preview, size, hash, and URI metadata. Disabled directions also strip known payload attribute keys such as `text`, `query`, `prompt`, `messages`, `input`, `output`, `preview`, `content`, `delta`, `body`, and `filter` from span, event, artifact, run, and edge attributes.

`redactRecord(record)` runs after capture modes and before sanitization. Return a replacement record to redact in place, or `null` to drop it. Hook errors fail closed: the record is dropped and counted in `observabilityDiagnostics().redactedRecords`.

## Transport Delivery

`CruxObservabilityTransport.send()` is an at-least-once, per-record delivery boundary. Every call returns an indexed `CruxDeliveryReceipt`; missing, duplicate, or ID-mismatched dispositions are retried. Transports and collectors must be idempotent by immutable `recordId`.

The engine owns batching, exact UTF-8 request chunking, record/byte queue bounds, jittered retry backoff, and bounded diagnostics. `transport.maxRecordsPerRequest` and `transport.maxRequestBytes` bound each send. `observe.flush()` and `observe.shutdown()` return structured results with delivered, rejected, remaining, and deadline state; a deadline never clears retryable records silently.
