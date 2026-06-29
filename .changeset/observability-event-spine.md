---
'@use-crux/core': major
'@use-crux/ai': patch
'@use-crux/convex': patch
'@use-crux/ingest': patch
'@use-crux/otel': major
---

Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.
