---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
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

Harden durable delivery against concurrent manual resumes and predicate
evaluation races. Manual resume now arbitrates atomically with armed waiters
and timers, busy in-process wakes remain retryable, predicate waits retain one
durable binding with a FIFO occurrence queue, and retry snapshots preserve
newly observed replay fingerprints and concurrently accepted candidates.
Persist Signal payloads through a lossless codec that preserves negative zero
and returns detached, deeply frozen occurrences. Eval execution rejects
durable reactive dispatch before allocation while retaining process-local
publication. Reactive adapter conformance now requires deterministic
transaction-abort injection and verifies rollback across every write boundary,
including multiple required deliveries.

Signal-driven Flow resumes retain the same in-process Effects scope reference
across suspension snapshots without claiming cross-process Effects recovery.

Document the shipped surface with a progressive Signals guide, copy-pasteable
current-API recipes, exact Signal and Flow-wait reference pages, public JSDoc,
and provider-neutral architecture guidance. The documentation distinguishes
process-local acceptance, certified durable delivery, consumer completion,
and a persisted Effect scope reference from restart-safe recovery.

Require cryptographically secure occurrence identities for durable
publication while retaining a process-local fallback, isolate mutable
acceptance timestamps across receipts, records, and listeners, and trim the
Runtime Signal adapter contract to the occurrence and Flow-delivery surface
actually shipped. Add an exact adapter reference for records, payload codecs,
named composites, durability declarations, and required reactive conformance.

Complete the pre-launch alpha Runtime Engine queue-record migration. Use
`RuntimeWorkItem` for queue records and `RuntimeWorkState` for their lifecycle;
`WorkItem` and `WorkStatus` are removed. Adapter declaration merging targets
`RuntimeWorkItem` directly through `@use-crux/core/runtime`.

Add inert Runtime managed-transport declarations and pure validation for
provider-neutral bindings and accepted envelopes.

Add immutable `RuntimeProgram` construction with canonical manifest hashes,
shared Runtime target normalization, and managed-binding resolution and
compatibility diagnostics for generated and hand-written hosts.

Generate a freshness-bound Runtime program and add `crux runtime worker` for
one configured Node/PostgreSQL execution worker with durable ownership and
bounded signal shutdown.
