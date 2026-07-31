---
"@use-crux/core": minor
---

Add typed process-local Signals with Standard Schema normalization, predicate
and recursive match identities, idempotent publication, isolated callbacks,
and explicit process-local acceptance receipts. Declared Flow Signal sources
now support typed `flow.waitFor(signal)` suspension, capability-gated durable
acceptance, atomic occurrence/delivery commits, restart recovery, stable
at-least-once delivery identity, and payload-safe idempotent replay after
consumer completion. Runtime adapters remain source-compatible through an
optional Signal-record port; durable bindings reject capability preflight when
that port or a durable storage declaration is absent. Flow delivery retries now
rotate replay/observability snapshots atomically with the retry work and outbox.
