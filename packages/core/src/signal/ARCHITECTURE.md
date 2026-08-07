# Signal architecture

This document describes the shipped Signal implementation in
`@use-crux/core`: typed process-local publication and durable Signal-to-Flow
waits. It is an internal ownership guide, not an additional public contract.

## Ownership

| Concern | Owner |
| --- | --- |
| Definition, schema validation, filters, receipts, local callbacks | `src/signal/` |
| Static Signal declaration and `FlowScope.waitFor(source)` inference | `src/flow/` |
| Wait registration, occurrence/delivery commit, wake, retry, settlement | `src/runtime/` |
| Durable record implementation and transaction semantics | The configured `RuntimeStoreAdapter` |
| Deployment and wake mechanics | Runtime composers and external adapter packages |

Core remains provider-neutral. Signal code depends only on Core's schema,
storage, Flow, and Runtime contracts. A provider package may implement the
optional Runtime Signal port; Core must never import that provider or infer
support from its package name.

## Process-local data flow

`signal({ id, schema })` captures the identity and schema and creates isolated
definition-local state. Construction performs no I/O and registers nothing.

For publication without a participating durable waiter:

1. `Signal.publish()` runs the Standard Schema validator.
2. The normalized output is cloned, checked for plain JSON, and deeply frozen.
3. Definition-local idempotency compares the canonical payload when a key is
   present.
4. Acceptance creates a receipt and occurrence with one shared identity.
5. Listener snapshots are scheduled in microtasks after acceptance.

The receipt is `process-local`. Callback latency and failure cannot change it.
Subscriptions are future-only, have no persisted cursor, and disappear with
the JavaScript process.

## Durable data flow

A Flow definition may contain a bare Signal, match view, or predicate view in
its `signals` map. Activating any such Flow first checks the exact
`signal.durable-delivery` capability profile. The handler and work allocation
do not start when preflight fails.

When `FlowScope.waitFor(source)` first executes, the Runtime commits the Flow
suspension and required Signal waiter in the named
`flow.signal-wait.register` composite. A matching publication runs the named
`signal.publish` composite:

```text
validated occurrence
  -> resolve armed waiters for the Signal id
  -> apply canonical match data in the transaction
  -> write one occurrence record
  -> write one stable delivery record per required waiter
  -> emit the selected durable event/outbox work
  -> commit all records, or commit none
```

The public receipt is `durable` only when a required durable waiter
participates. With no matching required waiter, the Runtime declines durable
acceptance and the definition performs honest process-local acceptance.

## Atomic occurrence and required-delivery law

An accepted durable occurrence must never exist without every delivery that
was required at its acceptance boundary. Occurrence, delivery, event, waiter
transition, and outbox writes therefore share the store transaction. Any
failure rejects publication before acceptance and rolls the whole composite
back.

This law does not wait for consumer execution. The outbox owns later wake
delivery. Consumer success, retry, failure, or dead-letter state cannot rewrite
the publication receipt, and one delivery cannot settle another.

Wait registration is atomic for the same reason: the Flow snapshot cannot say
it is suspended while its required waiter is absent. Timer and manual-resume
arbitration settle or cancel the same owned bindings rather than racing them.

## Capability preflight

`signal.durable-delivery` requires all of:

- `RuntimeStoreAdapter.durability === "durable"`;
- the optional `RuntimeStoreAdapter.signals` port;
- atomic `transact()` semantics for named composites;
- durable events and cursor reads;
- durable waiters and leases;
- at-least-once wake delivery.

Omitted capability data is unproven, not implicitly supported. The default
in-memory `node()` store declares process-local durability and cannot activate
a static Signal Flow wait. Adapter authors must run the reactive composite
conformance suite, including deterministic rollback at every write boundary;
a structural TypeScript match alone does not certify semantics.

## Filters, retry, and replay

Match views retain detached canonical JSON. Arrays and scalars use exact
equality; included object fields recurse. Predicate views retain deployed code,
not serialized closures. The waiter persists only the predicate requirement,
and the deployed Flow target evaluates candidates.

An occurrence and each required delivery keep stable IDs across at-least-once
wake attempts. Retry commits the next work state, delivery attempt state,
outbox entry, and merged Flow replay snapshot atomically. Completed named Flow
steps use normal skip-replay. If deployed code no longer follows the recorded
wait path, ordinary Flow replay-divergence protection applies rather than
silently consuming an incompatible delivery.

## Effects boundary

Signal-driven Flow resume carries the Flow's `EffectScopeRef` through
suspension and retry snapshots. Live reuse requires both the scope ID and run ID
to match; collision or stale-reference paths rotate the boundary instead of
joining another Flow's ledger.

Only the ref is JSON-safe persisted metadata. Effect receipts, captured state,
recovery handlers, and ledger state remain process-local. The ref cannot
reconstruct rollback after restart and must never be described as a durable
recovery ledger.

## JSON, privacy, and idempotency bounds

Normalized payload and match data accept only finite, acyclic plain JSON.
Accepted values are detached and frozen; durable records use the versioned
lossless Signal payload codec. Schema-invalid or JSON-unsafe input consumes no
occurrence identity.

Idempotency is scoped by Signal identity and a versioned hash of the caller's
key. Replay requires equal canonical normalized payload and returns the
original receipt. Conflicting reuse rejects before a second occurrence exists.
The raw key is never stored in the Signal record or returned publicly.

Public errors and diagnostics omit raw keys, credentials, payload fields,
prompts, and consumer internals. That is a diagnostic boundary, not a storage
classification: deployments still own payload retention, access control,
encryption, namespace isolation, and deletion policy.

## Managed transport Signal providers

Webhook Signal providers reuse the Runtime managed-transport kernel rather than
inventing a second queue or worker:

1. Edge `webhook({ handle })` authenticates and size-checks the request.
2. `acceptTransportEnvelope()` durably commits the accepted envelope and
   updates bounded transport statistics in the same transaction.
3. The host acknowledges the provider only when `acknowledge` is true.
4. The single Runtime worker claims envelopes and runs provider `onEvent`
   through `createTransportNormalizationRunner()`.
5. Successful publication records Signal occurrence lineage on the envelope
   (`signalId` + `occurrenceId`) and credits normalized/delivered stats.
6. Failures schedule bounded retry or enter `dead-letter`; operators call
   `replayTransportEnvelope()` explicitly.

Identity remains `(namespace, provider, accountId, eventId)`. Statistics use
the shared statistics ledger export under owner kind `transport`, with exact
totals and first-64 `adapterId/bindingId` attribution. Terminal envelope
retention is `RuntimeRetentionConfig.transportEnvelopes` (default `7d`) and
only prunes `normalized` and `dead-letter` rows through ordinary maintenance.

Inert `managedTransportBinding()` projections hold stable target and config
references only. Live credentials, `Request` objects, clients, and callbacks
stay on process-local provider definitions and never enter generated Runtime
program bindings.

`projectTransportEnvelope()` is the privacy-safe operator/Devtools view: state,
attempts, safe failure codes, and occurrence lineage without payload bytes.

## Deliberate limits

This slice owns no historical replay for later local subscribers, consumer
completion acknowledgment, or cross-process callback bus. Polling, SSE,
WebSocket, and generic stream supervision remain issue #340 and must not be
inferred from webhook provider identities or transport envelope records.
