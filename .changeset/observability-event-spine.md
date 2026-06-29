---
'@use-crux/core': minor
'@use-crux/otel': minor
---

Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

Add an OTel records mode with `withTelemetry({ mode: 'records' })` and `createOtelRecordSubscriber()`, allowing OTel spans to be projected from the canonical graph-record stream while the legacy hooks path remains available during migration.
