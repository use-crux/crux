---
"@use-crux/core": patch
"@use-crux/postgres": patch
"@use-crux/convex": patch
---

Declare `@use-crux/core/runtime` and its store-adapter contract experimental while Runtime Engine stabilization continues.

Remove unused Runtime Engine dead port exports, validate `crux.flows.signal()` against the durable flow snapshot before emitting, warn once when a durable target name is re-registered with a different definition, and make production `createRuntimeHandler()` fail closed unless wake request verification is configured explicitly or supplied by the wake adapter.

Embed delivered event payloads in runtime flow snapshots so flow replay no longer scans the event log after delivery. Store adapters must persist the `payload` field passed to `state.markSnapshotDelivered()`.
