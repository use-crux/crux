---
"@use-crux/core": minor
"@use-crux/local": patch
"@use-crux/otel": patch
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
