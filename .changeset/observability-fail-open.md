---
"@use-crux/core": minor
"@use-crux/local": patch
"@use-crux/otel": minor
---

Harden observability emission so invalid optional metrics and JSON-hostile payload values are sanitized before fan-out, with invalid records counted instead of thrown into application code.

Bound observability delivery queues, count oldest-record drops, and contain synchronous transport throws so devtools or custom transport failures do not escape into application code.

Retry failed observability deliveries on capped backoff, guard resets against stale in-flight requeues, and add `teeObservabilityTransport()` for composing capture sinks with existing transports.

Move observability request chunking into the delivery engine, add the transport v2 idempotency/flush/shutdown contract, batch records on a short timer, and skip graph-record construction when no observability sinks are active.

Split the manual span end API so attributes must be passed through `setAttributes()` or `end({ attributes })`, guard captured `endRun()` calls against duplicate terminal records, and finalize streaming generation spans once with merged completion and stream metrics.

Specify and test no-AsyncLocalStorage degradation: synchronous `withContext()` scopes still preserve run/span parentage, contextless event/artifact/edge attempts are counted in diagnostics, and observability invariants are property-tested across arbitrary public inputs.

Harden OTel runtime projection: late child spans stay parented to the run trace, open span registries are bounded with `crux.expired` evictions, duplicate telemetry installs no-op after a warning, and missing TracerProviders fall back to lightweight span tracking.

Harden observability privacy capture: input/output capture modes now support `inline`, `reference`, and `off`; payload-shaped event and span attributes are stripped when capture is disabled; `redactRecord()` can fail-closed by dropping records; and the OTel mapper drops known payload attributes by default.

Switch observability trace/span IDs to W3C-compatible lowercase hex, add per-run `seq` ordering to graph records and local raw-record storage, and let lightweight OTel exports reuse Crux span IDs directly.

Add observability correlators with `propagateAttributes({ sessionId, userId, metadata })`, wire devtools `sessionId` as a default correlator, and let the local run list persist and filter runs by session ID.

Harden the TypeScript observability contract so schema/type drift, span family mismatches, missing OTel primitive names, and unknown metric keys fail at compile time. Span options now derive `family` from `primitive`, custom metrics must use `custom.*`, and `subscribeObservability()` supports narrowed record-type filters.

Split observability presentation/read-model types out of the wire contract module into a separately versioned presentation module while preserving root `@use-crux/core/observability` exports, and make imperative devtools cleanup restore by install token instead of a shared runtime slot.

Move OTel GenAI projection to the pinned `genai-dev-2026-06` semantic convention table: span names now use GenAI operation names, provider/timing/finish-reason attributes use the new keys and value shapes, array attributes pass through, and message content is exported only with explicit `captureMessageContent` opt-in.

Add shared TS/Go observability conformance fixtures, document schema-version policy, and make the local Go runtime preserve unknown record types and extra fields as raw records for forward compatibility.

Move local observability run-list counts and token/cost totals to ingest-time SQLite rollups, add the supporting schema migration/indexes, and prepare ingest upsert statements once per batch.

Tighten observability delivery correctness: diagnostics now expose total delivery failures, HTTP transports no longer re-validate already accepted batches before posting, failed in-flight batches requeue without over-dropping at the queue bound, tee transports forward lifecycle hooks, and hostile user values remain contained.

Update local observability HTTP ingest semantics to partially accept parseable batches with `{ accepted, rejected }`, reserve `400` for malformed JSON, return retryable `503` on transient storage failures, and bound resource/read-model history queries with batched attachment loading.

Coalesce streaming generation text into `token.chunk` events, cap stored token chunks per span, exclude them from heavy run-detail reads, add a lazy focused-span events endpoint, and broadcast coalesced live token updates.

Bound local observability history with activity-based lifecycle reconciliation and retention. Crashed running runs are reconciled once, active streams avoid false stale states while chunks arrive, old/excess runs are deleted in bounded batches, and oversized artifact previews are replaced with truncation markers.

Make local devtools websocket broadcasts backpressure-safe with per-client send queues, write deadlines, and stalled-client eviction, and lock observability scaling budgets with Go benchmarks.

Update the devtools runs UI to group by root `sessionId`, render backend-owned token/cost/count rollups from the observability list endpoint, and stream focused-span `token.chunk` text through the lazy span-events endpoint.
