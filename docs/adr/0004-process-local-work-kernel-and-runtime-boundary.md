# ADR 0004: Process-Local Work Kernel And Runtime Adapter Boundary

Status: Accepted

Date: 2026-08-01

## Context

Core now has two Work-shaped foundations with different responsibilities.

The internal process-local Work kernel gives first-party code one finite,
joinable execution boundary with a stable Effect scope. The public Runtime
Engine already has a durable queue state machine whose records are persisted by
adapters. Treating those as one type or implying a public application Work API
would blur lifecycle ownership, overstate durability, and expose internal target
authority before its contract exists.

This ADR fixes the boundary for the shipped foundations. It does not define a
public application-facing Work surface.

## Decision

### Process-local lifecycle

Each `createProcessLocalWorkKernel()` call owns an isolated registry. Accepting
one internal target driver creates exactly one occurrence:

`queued -> running -> completed | failed`

The kernel owns the occurrence id, acceptance and transition timestamps,
scheduling boundary, status snapshots, result promise, and passive Effect scope.
Snapshots are detached from stored timestamps. A caller cannot mutate registry
state through a returned `Date` or status object, and a failed status never
retains the raw thrown value.

There is no global registry or implicit target discovery. Duplicate ids inside
one kernel instance are rejected.

### Target and attempt ownership

An `InternalWorkTargetDriver<TOutput>` is the only execution seam. First-party
binders own target-specific invocation semantics and exact output typing. The
kernel calls the bound driver once and owns the surrounding lifecycle; the
driver does not choose ids, states, Effect scopes, or retries.

The current Flow binder uses a Flow handle's existing execution authority. It
accepts only a completed Flow result as finite Work output. Suspension is not
silently converted into a process-local continuation.

One accepted process-local occurrence contains one attempt. A target rejection
settles that occurrence as `failed` and the result promise rejects with the
original value. The kernel does not retry it. A future retry policy must create
an explicit attempt model rather than recursively invoking the driver or
reusing a settled occurrence implicitly.

### Effect allocation is part of acceptance

The kernel allocates the passive Effect boundary before returning a handle. The
handle's Work id and Effect scope therefore become observable together. If
boundary allocation fails before the scope is available, `spawn()` rejects and
the provisional registry entry is removed, allowing that id to be allocated
again. Target execution begins only through the configured scheduler after the
scope exists.

This is caller-visible atomicity, not a durable transaction. Effect receipts,
the registry, status, and result promise all remain in memory.

### Process-local durability limit

Process termination loses the registry, in-flight result promises, and live
Effect recovery authority. The kernel performs no serialization, lease
fencing, cross-process join, replay, or restart recovery. Its `completed` state
means the in-process target returned successfully; it is not a durable delivery
claim.

The internal driver interface is the extension seam for first-party target
binders only. Adding another binder does not export target registration,
transport, provider, route, inspection, or application-level Work APIs.

### Runtime Engine adapter boundary

Durable Runtime execution uses the separate public
`RuntimeWorkItem`/`RuntimeWorkState` contract from
`@use-crux/core/runtime`. `RuntimeWorkItem` is the field-owning interface. The
Runtime kernel owns record identity, transitions, logical attempts, retry
classification and delay, lease fencing, idempotency, suspension, completion,
and failure. Store adapters persist the record and implement atomic storage
boundaries; they do not choose lifecycle policy.

Adapter packages may declaration-merge optional storage-owned fields directly
into `RuntimeWorkItem` through `@use-crux/core/runtime`. The adapter must
initialize and losslessly round-trip those fields. This extension seam cannot
add Runtime states, change Core field meaning, or attach application business
state to the queue record.

The process-local kernel does not persist itself by writing a
`RuntimeWorkItem`, and a Runtime adapter does not acquire authority over an
internal Work handle. They may be connected only by a future explicit bridge
that defines identity, attempt, result, Effect, and recovery semantics across
the boundary.

### Boundary with future Work

Any future durable or application-facing Work feature must make its own public
contract explicit. In particular, it must decide whether one logical Work has
many durable attempts, how joins survive process loss, which target definitions
are executable, how results are retained, and whether Effect recovery is local
or durable. It must build on the Runtime kernel through an explicit adapter or
bridge rather than exporting the current internal kernel wholesale.

Future design specifications remain proposals. Their application-facing names
and lifecycle types are not aliases for Runtime Engine queue records.

## Consequences

- First-party code can use a small, deterministic process-local execution
  kernel without creating a public product surface.
- The Effect scope is always available on a returned internal handle, and
  allocation failure leaves no reserved registry id.
- Process-local failures are honest and finite: no hidden retry and no raw
  failure retained in status.
- Runtime adapter authors get one canonical augmentable record interface and
  one state union, while the Runtime kernel retains policy ownership.
- Durable application Work requires a later explicit design; persistence or
  restart safety cannot be inferred from the internal kernel.

## Validation

- Type tests import and augment `RuntimeWorkItem` through
  `@use-crux/core/runtime` and reject the removed Runtime record names.
- Runtime work tests cover legal transitions, lease cleanup, attempts, retry
  metadata, errors, results, and immutable records.
- Process-local tests cover typed Flow output, lifecycle snapshots, stable
  Effect scope, allocation failure cleanup, target rejection, detached
  timestamps, and rejection of non-completed Flow outcomes.

Treat this ADR as the internal architectural boundary. The Runtime Engine
reference documents the shipped adapter record; future application Work design
documents do not amend this decision until their public contract is accepted
and implemented.
