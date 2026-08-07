---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/otel": minor
"@use-crux/postgres": minor
"@use-crux/convex": minor
"@use-crux/cloudflare": patch
---

Add the `@use-crux/core/effect` surface for typed effects, immutable receipts,
individual recovery, automatic and delayed rollback, honest ambiguity
reconciliation, receipt-safe evidence, and canonical observability records.

Persist Effect receipts, scopes, recovery units, attempts, and envelopes through
a Runtime store Effects port. Restart-safe reconstruction rebuilds the exact
reverse recovery plan and stable recovery idempotency keys. Crash windows
surface prepared work for reconciliation, project interrupted running work as
unknown, and reject stale fenced writers so only one concurrent terminal
transition commits. The external Runtime worker now discovers interrupted
rollback scopes, acquires expiring fenced claims, and executes the exact
store-reconstructed plan with stable recovery idempotency keys. A replacement
worker can reclaim work after process loss without allowing a superseded holder
to settle stale writes.

Declare immutable Effect recovery targets on `createRuntimeProgram({
effectTargets })`. Generated Next, Convex, and Cloudflare hosts bind those
targets. Missing or version-mismatched cold targets settle as
`handler_unavailable`. A recoverable Effect without a program declaration stays
callable and recovers through its live definition in the same process.
Worker recovery resolves handlers only from this immutable program table and
does not silently retry crash-ambiguous recovery attempts.

Ship PostgreSQL and Convex durable Effects adapters behind a shared conformance
matrix. Convex supports per-operation atomicity, crash fencing, and
reconstruction, and declares multi-operation `transact()` callbacks unsupported.
Bounded `effectEnvelopes` retention expires recovery envelopes while keeping
receipt and audit metadata. Sealed request and tool-outcome linkage attach only
in journaled contexts.

Discover Effect definitions in the Project Index and surface their authored
identity and recovery configuration in Catalog, alongside receipt, outcome,
recovery-link, and ambiguity evidence in Devtools Runs. Report
`effect.recovery_not_runtime_addressable` when an unexported recoverable Effect
is statically visible at a required recovery boundary under Runtime-backed
configuration, and
`effect.irreversible_in_required_boundary` when an irreversible Effect is
certainly called inside a required-recovery `rollbackOnError()` boundary.

Make exported Effect definitions eligible for the language server's generic
completion candidate pipeline while retaining kind-generic hover titles and
duplicate-identity diagnostics.

Make flow runs and pipeline, agent, and composition roots passive rollback
boundaries. Their results expose Effect scope references, and flows can
explicitly recover completed units through `flow.rollback()`.

Work and Session turn Effect scopes keep the admission identity through
execution. `work.cancel()` and ownership detach fence execution without
rolling back completed external Effects; recovery stays an explicit
`rollback()` / `recover()` / worker policy choice. Detached ownership
(`explicit` or `owner-ended`) preserves receipts and recovery access without
reparenting the Effect scope, and ambiguous outcomes remain reconcilable.

Add an internal audit-first native Effect contract so first-party domains can
contribute receipts, evidence, and Effect facets on their existing spans while
reporting unavailable or irreversible recovery honestly.

Export Effect spans through the OpenTelemetry adapter with the canonical
`crux.effect.run` span name.
