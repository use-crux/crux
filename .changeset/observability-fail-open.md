---
"@use-crux/core": patch
---

Harden observability emission so invalid optional metrics and JSON-hostile payload values are sanitized before fan-out, with invalid records counted instead of thrown into application code.

Bound observability delivery queues, count oldest-record drops, and contain synchronous transport throws so devtools or custom transport failures do not escape into application code.

Retry failed observability deliveries on capped backoff, guard resets against stale in-flight requeues, and add `teeObservabilityTransport()` for composing capture sinks with existing transports.

Move observability request chunking into the delivery engine, add the transport v2 idempotency/flush/shutdown contract, batch records on a short timer, and skip graph-record construction when no observability sinks are active.
