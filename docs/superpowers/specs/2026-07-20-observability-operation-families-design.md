# Observability Operation Families Design

## Status

This document defines the durable identity and presentation contract for nested
Crux work. It is a design specification, not an implementation.

The approved product boundary is:

> One Runs-page row represents the originating request or action. Durable
> Flow, swarm, and deferred work remains nested beneath that operation even
> when it continues after the root run has ended.

The design preserves the multi-invocation reliability contract introduced by
ADR 0002. Durable work still owns an independently suspendable and resumable
`runId`; the change is that lifecycle ownership no longer determines top-level
Runs-page presentation.

## Problem

ADR 0002 separated three identities:

- `runId`: one logical lifecycle owner;
- `traceId`: distributed causal correlation;
- `segmentId`: one physical process, isolate, or invocation.

That separation is correct for durability, but the current read model presents
every `runId` as a top-level Run. Core Flow also unconditionally opens a new run
for every fresh Flow, including synchronous child Flows inside an already
observed agent request. A Karyla agent request that launches two parallel
research Flows therefore appears as three Runs even though it is one
user-visible operation.

The problem is not failed context propagation. The child Flows correctly share
the parent's `traceId` and require distinct `runId` values if they may suspend.
The missing concept is an explicit operation family that groups lifecycle
owners without collapsing their identities.

The current attempted compensation—a separately emitted `triggered` edge from
an ambient span to the child run—is insufficient as the grouping contract:

- the run start and edge can be delivered independently;
- the child run can be paginated or retained without its edge;
- the live Karyla evidence that exposed this regression contained the child
  runs but not their intended run-level `triggered` edges;
- a shared `traceId` cannot be used as a fallback because Evals and other
  distributed traces may intentionally contain multiple top-level operations.

## Executive decision

Keep `runId` as the durable lifecycle identity. Add explicit operation-family
and parent topology to every run.

```text
operationId = root run's runId

operation run_karyla
└── root run run_karyla
    └── span tool.call research
        ├── child run run_research_a
        └── child run run_research_b
```

No fifth random identifier is needed. The root run's `runId` is also the
family's `operationId`; child runs copy that value. The field is nevertheless
carried explicitly and never inferred from `traceId`, timing overlap, names,
sessions, or graph shape.

Each run has:

```ts
interface CruxRunTopology {
  /** Root run id for the user-visible operation family. */
  readonly operationId: CruxRunId;
  /** Immediate lifecycle parent. Absent only on the operation root. */
  readonly parentRunId?: CruxRunId;
  /** Exact span in the parent run that caused this child run. */
  readonly triggeredBySpanId?: CruxSpanId;
}
```

The identity meanings become:

| Identity | Meaning |
| --- | --- |
| `operationId` | Root `runId` for one Runs-page operation family |
| `runId` | One independently owned logical lifecycle |
| `traceId` | Distributed causal correlation; may contain several operations |
| `segmentId` | One contiguous physical execution of a run |
| `parentRunId` | Immediate structural parent within an operation |
| `triggeredBySpanId` | Parent span under which the child run is presented |

## Run-opening contract

Run creation must make root versus child ownership explicit.

### Root runs

`observe.openRun()` opens a root operation:

- generate a new `runId`;
- set `operationId` to that same `runId`;
- omit `parentRunId` and `triggeredBySpanId`;
- generate a new `traceId` unless the caller deliberately supplies one.

Supplying an existing `traceId` to `openRun()` creates another root operation
in the same distributed trace. It does not join an existing operation. This is
the required behavior for Eval cases and other intentionally separate roots.

### Child runs

Add an explicit child-run API, preferably:

```ts
observe.openChildRun(parentContext, {
  name,
  rootPrimitive,
  attributes,
  definitionRefs,
})
```

It must:

- generate a new `runId` and `segmentId`;
- inherit `operationId` and `traceId` from the captured parent context;
- set `parentRunId` to the parent's current `runId`;
- set `triggeredBySpanId` to the parent's current span when present;
- reject a missing or malformed parent instead of silently opening a root.

The explicit API prevents first-party code from accidentally implementing a
child as `openRun({ traceId })`, which preserves correlation but loses family
topology.

### Resumption

`observe.resumeRun()` retains the same `operationId`, `runId`, `parentRunId`,
and `traceId`, while generating a new `segmentId`. A resume is never a new
child and never changes operation membership.

`CapturedObservabilityContext` and `CruxPropagationCarrier` must carry
`operationId`. A continuation does not need to repeat parent topology on every
host hop, but it must retain enough immutable run identity for every resumed
record to carry the same operation membership. Implementations may retain
`parentRunId` in the carrier as an integrity check if that avoids a process
registry lookup; it must never change on resume.

### Detached work

Work deliberately presented as a new operation calls `openRun()`, even when it
shares a `traceId` or records a causal edge to an earlier operation. Detachment
is an explicit lifecycle decision, not something inferred because a host
boundary was crossed.

## Primitive ownership matrix

Ownership follows lifecycle capability, not primitive name.

| Primitive or boundary | Ownership |
| --- | --- |
| Standalone request, action, cron, or command | Root run and new operation |
| Incoming Convex/serverless boundary with propagated context | Continue current run context; boundary span only |
| Generation, tool call, retrieval, memory, guardrail | Span in current run |
| Agent invocation inside an observed operation | Span in current run |
| Delegate invocation | Span in current run |
| Core pipeline, parallel, consensus | Composition span in current run |
| In-process Core swarm | Composition span in current run |
| Standalone durable Flow | Root run and new operation |
| Durable Flow invoked inside an operation | Child run in the same operation |
| Convex durable swarm invoked inside an operation | Child run in the same operation |
| Named durable `defer` execution | Child run in the scheduling operation |
| Inline deferred callback | Span in the current run |
| Future durable pipeline/workflow | Child run when nested; root run when standalone |
| Eval case | Explicit root operation, even when sharing an Eval trace |

This keeps the current Core composition runtime mostly unchanged: pipeline,
parallel, consensus, and the in-process swarm already open spans. The affected
first-party owners are Core Flow, Convex durable swarm, named durable defer,
and any future composition that can suspend or outlive its caller.

A primitive must not begin as a span and retroactively fork into a run only
when it suspends. Records emitted before suspension would already have the
wrong `runId`, and moving them would violate immutable record identity. A
durable-capable nested primitive therefore owns a child run from its start,
even when a particular invocation completes synchronously.

## Wire and storage contract

The operation family is correctness-critical identity, not optional
presentation metadata.

The next observability schema version must:

- add required `operationId` to the common graph-record base;
- add optional `parentRunId` and `triggeredBySpanId` to `run:start`;
- require both parent fields to remain immutable for a given child `runId`;
- require a root run to have `operationId === runId` and no `parentRunId`;
- require a child run to have `operationId !== runId` and a `parentRunId`;
- require child and parent records to use the same `operationId` and `traceId`
  once both are present, while accepting out-of-order arrival;
- retain operation identity across `run:suspend`, `run:resume`, and `run:end`.

The local schema gains:

- `operation_id` on immutable raw records and `runs`;
- `parent_run_id` and `triggered_by_span_id` on `runs`;
- an indexed operation-membership path;
- one revision stream keyed by `operation_id` for operation-list and detail
  invalidation.

Ingest must accept a child before its parent. Missing parents are incomplete
topology, not invalid input. Once both arrive, conflicting operation or trace
membership is an immutable identity conflict and must be diagnosed without
rewriting the first accepted records.

Because existing records cannot be truthfully assigned to operation families
from `traceId`, names, or timestamps, the schema migration should reset only
the local observability tables, following the existing pre-launch schema-v2
cutover pattern. It must not ask users to delete `.crux`, and it must not touch
Quality, Project Index, review, or other local data.

The TypeScript and Go schema versions advance together. This changes the graph
wire contract and public observability behavior, so the implementation needs a
Changesets entry. It does not change Project Index output or Eval evidence
comparability by itself, so no Project Index or Eval cache epoch is required.

## Canonical read model

Keep the per-`runId` model as the internal lifecycle source of truth. Add one
operation-family projection as the sole source for the product's Runs list.

An operation summary contains:

- `operationId` and root `runId`;
- root name, primitive, session, user, start, terminal status, and error;
- aggregate span, event, artifact, edge, token, and cost counts across all
  member runs;
- `childRunCount`;
- `activeChildCount`, `suspendedChildCount`, and `failedChildCount`;
- latest family activity time;
- delivery and topology health;
- one monotonic operation revision.

Root status remains authoritative. A successfully completed agent request does
not become `error` merely because it handled a failed child Flow. Descendant
failures are visible through child-health fields and diagnostics. Likewise, a
root request may be terminal while background children remain active; the row
shows the root outcome plus background activity instead of changing the root
status back to `running`.

Status filtering applies to root status. Separate descendant-health filters
can be added only if demanded by product usage; they are not required for the
first implementation. Definition filtering matches an operation when any
member run has activity for the definition, while the displayed identity and
status still come from the root.

The Runs-page endpoint returns one row per operation. It must not client-merge
an operation list with a second run list. Internal APIs may expose lifecycle
runs for diagnostics and detail, but they are not independently authoritative
for top-level row presence or pagination.

## Run detail and graph composition

Opening an operation loads all member runs by `operationId` and preserves their
run and segment boundaries. It does not flatten raw records into a fabricated
single run.

Presentation mounts each child run's root beneath `triggeredBySpanId`. If the
trigger span is unavailable, it mounts beneath the parent run with an
`incomplete-topology` diagnostic. If the parent run is also unavailable, the
child remains visible as an orphan member of the operation.

The parent topology on `run:start` is sufficient to synthesize the structural
run edge in the read model. Emitters may continue producing a canonical
`triggered` graph edge for raw graph consumers, but product grouping and
parenting must not depend on receiving that second record.

Deep links must retain exact addressing. Operation navigation uses
`operationId`; a selected child run or span adds `runId` and `spanId`. Existing
result metadata based on `traceId` plus `spanId` remains valid and is outside
this design's public result-envelope scope.

Deleting an operation from the Runs page deletes all member observability
records transactionally. Retention expires the family from the root operation
policy and must not leave child rows promoted to accidental roots. A dedicated
internal child-run deletion operation may remain available for diagnostics,
but it is not part of the ordinary Runs UI.

## Failure and consistency behavior

- A child-run API call without a parent context fails immediately.
- A child record received before its parent is accepted and marked incomplete.
- A run observed with conflicting `operationId`, `parentRunId`, or `traceId`
  is conflicted; immutable content is never overwritten.
- A missing trigger span degrades topology only; it does not hide the child.
- A failed child contributes to descendant health, not root status.
- An active child after root completion contributes to background activity,
  not root lifecycle status.
- A continuation with a mismatched operation identity is rejected before any
  resumed record is emitted.
- Delivery health and topology health remain separate so a structurally
  incomplete family is not mislabeled as transport loss without evidence.

## Verification

Implementation must include these vertical proofs:

1. Core observability proves root, child, detached-root, suspend/resume, and
   invalid-carrier identity invariants.
2. A nested Flow under an agent produces one operation, two runs, and a stable
   parent trigger; Flow resume retains both `operationId` and `runId` while
   changing `segmentId`.
3. A standalone Flow remains a one-run operation.
4. Pipeline, parallel, consensus, in-process swarm, delegate, and ordinary
   agent execution remain spans and do not create child runs.
5. Convex durable swarm and named defer create child runs that remain in the
   originating operation across fresh invocations.
6. Eval cases sharing one trace remain separate operations.
7. Go ingest handles child-before-parent delivery, rejects conflicting family
   identity, and synthesizes detail topology without requiring a second edge.
8. The operation page returns one Karyla row for a root agent plus parallel
   research Flows, with aggregate counts and correct child-health fields.
9. A successful root with failed children remains successful and reports the
   failures separately; a terminal root with an active child reports
   background activity without reopening the root.
10. Web Devtools, TUI, CLI, search, definition activity, deletion, retention,
    pagination, and revision catch-up use the same operation identity.
11. TypeScript/Go schema fixtures and real Convex/serverless delivery gates
    prove operation identity survives transport and host boundaries.

The current nested-Flow test that asserts different `runId` values remains
valid but gains an `operationId` assertion. New tests must reject grouping by
shared `traceId` alone.

## Rollout boundaries

This design intentionally does not:

- collapse durable child runs into the root run;
- make `traceId` the Runs-page identity;
- infer families from session, time-window overlap, names, or primitive type;
- make descendant failures overwrite root status;
- introduce configurable grouping policies;
- change OpenTelemetry's trace/span semantics;
- migrate ambiguous historical observability rows;
- turn every composition into a run.

The implementation should land as one contract migration with focused
vertical slices: identity and carriers, first-party lifecycle owners, Go
storage/read model, then Devtools/TUI clients. Mixed producers using different
wire schema versions are rejected explicitly rather than partially grouped.
