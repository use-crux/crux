# ADR 0002: Observability Runtime Reliability — Execution Segments And Host-Aware Delivery

Status: Accepted

Date: 2026-07-11

## Context

ADR 0001 consolidated Crux observability around one event spine: graph records born once in
`emit()` and fanned out to subscribers, a diagnostics channel, and the async transport. That
decision is unchanged and still correct.

A subsequent reliability audit found that the layers built on top of that spine assumed a run and
its telemetry live inside one continuously-running process:

- The documented per-run `seq` was a process-local counter, removed on `run:end`. A suspended Flow
  resumed in a fresh process, a new Worker isolate, or a new Convex invocation could restart it from
  1, and the Go backend sorted raw records by `seq` as if it were a distributed total order.
- The HTTP transport treated any `response.ok` as full delivery success. The local Go server could
  return an HTTP `202` that accepted some records and rejected others; rejected records were silently
  lost.
- Delivery depended on an unref'd batching timer with no host-lifetime contract. A serverless
  invocation, a Workers `fetch` handler, or a Convex action could return (and be frozen or killed)
  before that timer fired.
- Flow suspension terminalized the run's observable shape (`run:end`) and relied on restoring a
  captured context later to resume it. Nothing but an implicit span made that "resume" mean anything
  to the logical run; a restored context cannot itself end or resume anything.
- Successful stream spans stayed open for up to ten seconds waiting for optional provider completion
  metadata that might never arrive.
- The lightweight OTel exporter path dropped export promises (fire-and-forget), and the standard SDK
  path created spans without making them the active context around the instrumented work — so nested
  spans did not parent correctly and no span survived a process boundary by construction, but nothing
  in the bridge treated that as an architectural fact either.
- A duplicate `recordId` with different content could overwrite the first, immutable payload.
- The DevTools Runs list merged a Quality-owned terminal-row list with a separately-fetched
  observability-owned running-row list on the client, making two read models simultaneously
  authoritative for the same table.
- Runtime coverage was Node-shaped: no real `workerd` gate, no Convex bundle/runtime conformance gate,
  no serverless freeze-after-return proof.

None of these are event-spine defects. They are the reliability boundary sitting one layer higher:
what a "run" is allowed to assume about the process it started in.

## Decision

Keep the event spine from ADR 0001. Replace every process-local lifetime assumption above with an
explicit multi-invocation contract.

### Three identities, never inferred from one another

- **Logical run** (`runId`): one user-visible operation. Begins once, may suspend/resume any number
  of times, ends exactly once.
- **Trace** (`traceId`): distributed causal correlation, W3C-interoperable.
- **Execution segment** (`segmentId`, with a `segmentSeq` monotonic only within that segment): one
  contiguous execution in one process/isolate/invocation. A segment never survives a host boundary.

A host boundary alone is not a suspension. A request can end successfully and separately start a
causally linked downstream run for queued or background work; only a genuine continuation of the same
logical operation emits `run:suspend` / `run:resume`.

### Explicit lifecycle ownership

The lifecycle union is `run:start` (first segment), `run:suspend` (ends the current segment without
terminalizing the run; carries a reason and optional sanitized continuation metadata), `run:resume`
(`segmentSeq` restarts at 1 in a fresh `segmentId`, always emitted before any child record), and
`run:end` (terminalizes the run exactly once; a duplicate byte-identical terminal record is
idempotent, a conflicting one is diagnosed and never overwrites the first). Mutation belongs to an
explicit owner (`observe.openRun()`, the returned handle's `.suspend()` / `.end()` / `.error()`, or
`observe.resumeRun(carrier, ...)`), never to `observe.withContext()`, which remains context-only and
cannot resume, suspend, or end a run by itself.

The durable ordering contract is a partial order — exact edges/parent IDs, then lifecycle boundaries,
then `(segmentId, segmentSeq)`, then normalized timestamp, then a stable `recordId` tie-break. There
is no distributed total sequence; concurrent segments are shown as concurrent rather than collapsed
into an invented wall-clock order.

### Schema v2, no dual-read window

`CRUX_OBSERVABILITY_SCHEMA_VERSION` advances to `2`; every record carries `segmentId`/`segmentSeq`.
Crux is pre-launch, so the cutover is destructive rather than compatibility-preserving: TypeScript and
Go accept schema v2 only, and the local SQLite migration transactionally discards pre-v2 observability
rows — they carry no truthful segment identity to migrate — and rebuilds the schema automatically.
Users are never asked to delete `.crux` by hand; every other local table is untouched.

### Lossless, receipt-aware delivery

Delivery success is per record, not per HTTP status. A `2xx` response is complete only when every
sent record has an accounted disposition (`accepted` or `rejected`, with a `retryable` flag); a
malformed or partial receipt retries every unaccounted record. `recordId` identifies immutable
content: a first occurrence persists, an exact duplicate is accepted idempotently without re-applying
rollups, and a different payload under the same id is rejected permanently as a diagnosed conflict —
`ON CONFLICT(record_id)` never updates payload, run, or sequence fields. Bounded diagnostics report
accepted/retried/permanently-rejected/overflow-dropped/deadline-dropped counts so a process that never
reconnects can still report what it knows locally.

### A framework-neutral host lifecycle port

Core exposes context/`defer`/deadline as a small port, not a runtime import. First-party wrappers bind
it: a Node adapter using `AsyncLocalStorage`; a generic serverless wrapper that awaits a bounded final
drain from remaining-time; a Cloudflare Workers wrapper that registers the drain with
`ExecutionContext.waitUntil` and needs no `nodejs_compat` flag for correctness; Convex wrappers that
await a short fixed bound before the action returns, since Convex exposes no per-invocation deadline
API. Every wrapper reports a structured `ObservabilityFlushResult` instead of a boolean, so an
incomplete drain is never silently discarded. No configuration can keep an already-returned invocation
alive if the adapter was never given the host's lifetime capability — that limitation is inherent to
the host, not a Crux gap to paper over.

### Stream terminal correctness

Only a stream's own terminal signal (drain, early return, or throw) ends its span, immediately, with
stream-derived metrics. There is no grace timer. Provider completion metadata that is still pending,
or that arrives after, attaches as a linked `usage.observed` event and output artifact and can never
reopen the span or change its recorded duration/status.

### An active OTel execution bridge

`withTelemetry()` makes the SDK span active around the actual instrumented callback instead of
creating a span after the work has already run, so nested spans parent correctly and
`trace.getActiveSpan()` resolves inside real work. `run:suspend` ends the segment's root span;
`run:resume` starts a fresh root span sharing the original `traceId` rather than reopening the
suspended one — no SDK span object crosses a process boundary. W3C `traceparent`/`tracestate` and an
explicit baggage allowlist round-trip through the same serializable carrier Flow/Convex use for
in-process resume. `forceFlush`/bounded `shutdown` track real exporter/processor promises and bind to
the host lifecycle port above instead of being fire-and-forget or blocking indefinitely.

### One revisioned Go Runs read model

The Go service, not the DevTools client, owns the join between canonical observability runs and
Quality annotations, keyed by an explicit persisted correlation field rather than an assumed
`traceId`/`runId` equivalence. Ingest is one transaction that also bumps a monotonic read-model
revision per affected run and publishes it after commit; DevTools performs a bounded revision-aware
catch-up (or a full invalidation once that window has aged out) instead of merging a
Quality-terminal list with a separately-fetched observability-running list on the client. Runs and run
detail distinguish `running`/`suspended`/`incomplete`(stale segment, no suspend/end)/`conflicted` from
ordinary terminal states, and delivery/export health is `unknown`/`healthy`/`degraded` — `unknown` is
never presented as healthy.

## Alternatives Considered

**Preserve a distributed total sequence by widening `seq` to a server-assigned number on ingest.**
Rejected: it would still require every producer to agree on a single ingest endpoint's clock and
cannot express genuinely concurrent segments; causal edges plus segment-local order plus timestamp
plus a stable tie-break already give a correct partial order without inventing false precision.

**Treat every host boundary as an implicit suspension.** Rejected: conflates "this physical
invocation is ending" with "this logical operation is ending," which would wrongly resume a
terminal run or wrongly keep an unrelated downstream job inside the parent's run. The distinction is
made explicit instead: same-run continuation is `run:suspend`/`run:resume`; unrelated downstream work
is a new, causally linked run.

**Keep a live SDK span object in a durable store and reopen it on resume.** Rejected: an OTel `Span`
object is tied to its process's SDK instance and cannot be serialized meaningfully; the reliability
model instead treats "same trace, new root span" as the correct unit for a resumed segment, using
remote-parent correlation or links for causality.

**Keep the client-side Quality/Observability run-list merge and add more client-side reconciliation
logic to patch its gaps.** Rejected: the merge's failure modes (a terminal Quality row and a running
Observability row both existing, or neither) are a structural consequence of two independently-owned,
independently-paginated read models. A single server-owned, revisioned join removes the class of bug
rather than special-casing more of it.

## Consequences

This is a breaking pre-1.0 change with no v1 compatibility window: existing local `.crux` observability
data does not survive the first startup against the new schema (every other local table is
unaffected), `InstrumentationHooks` (already removed by ADR 0001) and any process-local `seq` reliance
in third-party subscribers must move to `segmentId`/`segmentSeq`, and the Convex default flush window
drops from 20 seconds to a fixed 3-second bound. Raw Cloudflare Worker handlers and custom
serverless/Lambda entry points must pass their host's lifetime capability (an `ExecutionContext`, or
the documented drain call) to a first-party wrapper at least once; nothing can make an
already-returned invocation stay alive without it.

Real conformance work backs the contract rather than only unit tests: fresh-process Node suspend/
resume, a real `workerd` runtime (not a mocked global), a child-process freeze-after-return harness, a
Convex bundle/`convex-test` runtime gate, and a real `BasicTracerProvider`/`AsyncHooksContextManager`
harness for active-span/W3C propagation proofs. The current release's changeset and CHANGELOG record
the exact soak counts and any residual limitations at the time of the stable-beta decision; treat this
ADR as the durable architectural record and the changeset/CHANGELOG as the point-in-time evidence.

## Validation

Implementation must keep coverage at these boundaries:

1. Shared TypeScript/Go fixtures prove one-segment success/error/cancelled runs, suspend-in-process-A/
   resume-in-fresh-process-B with both segment sequences starting at 1, concurrent segments with no
   false total order, and duplicate-identical vs. conflicting-same-id records.
2. Flow/Runtime integration proves exactly one terminal `run:end` after any number of suspend/resume
   cycles, and that a durable child which can outlive its parent forks its own run instead of resuming
   an already-terminal one.
3. A partial-acceptance `202`, a dropped-after-commit response, `429`/`503` with `Retry-After`,
   oversized records/batches, queue overflow, and a host deadline mid-retry are all deterministic,
   loss-accounted faults, not silent successes.
4. Real `workerd`, a freeze-after-return child process, and a Convex bundle/runtime gate each prove
   bounded, host-aware drain behavior without relying on a mocked lifetime primitive.
5. `trace.getActiveSpan()` resolves to the Crux-created span inside real instrumented work; inject in
   one process/extract in a fresh one preserves trace correlation with no shared memory; exporter
   promises are awaited by flush/shutdown and stop at host deadlines.
6. The Go Runs read model and DevTools UI render suspended/incomplete/conflicted state and
   unknown/healthy/degraded delivery health truthfully, sourced from one revisioned join, never a
   client-side merge.
