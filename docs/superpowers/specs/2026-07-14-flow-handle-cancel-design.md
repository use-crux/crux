# Flow Handle Cancellation Design

## Context

Issue #134's durable flow runtime APIs shipped in `@use-crux/core` 0.4.0 and
remain in the current 0.5.0 release. The implementation and published types
include `flow.waitFor()`, `flow.defer()`, `flow.after()`, scoped
`flow.untilIdle()`, durable task targets, and name-bound `crux.flows.*`
operations.

The audit found one API omission and related documentation drift:

- The RFC's object-bound `reviewFlow.cancel(flowId)` is missing from
  `FlowHandle`; consumers must use the lower-level `cancelFlow(flowId)`.
- Missing-runtime guidance still shows the removed
  `reviewFlow.run({ resume: flowId })` form instead of
  `reviewFlow.resume(flowId)`.
- Durable effect documentation does not fully state the binding comment's
  positional replay identity and independent-child cancellation semantics.

## Public contract

Add this method to `FlowHandle`:

```ts
cancel(flowId: string): Promise<void>
```

The method intentionally has no reason parameter. Runtime Engine cancellation
does not persist a cancellation reason, and the handle must behave consistently
with and without a configured runtime. Code that cancels from inside a flow can
continue to use `scope.cancel(reason)`. Low-level object-store code can continue
to use `cancelFlow(flowId, reason)`.

## Execution paths

Without a Runtime Engine, `handle.cancel(flowId)` delegates to the existing
`cancelFlow(flowId)` record-store operation.

With a Runtime Engine, it delegates to a shared runtime cancellation operation
by flow id. Handle cancellation remains id-bound, matching the existing
object-bound `cancelFlow(flowId)` behavior in both modes. The name-bound
`crux.flows.cancel(name, flowId)` entry point supplies an expected target name
to the same helper and retains its target-mismatch validation.

Handle cancellation is idempotent for an unknown flow id and resolves without
error in both modes, matching `cancelFlow()`. Name-bound
`crux.flows.cancel()` remains strict: an unknown id throws `TARGET_NOT_FOUND`
because callers without a handle must prove the target identity explicitly.

The Runtime Engine cancellation composite atomically marks both the owning work
item and its flow snapshot `cancelled`, cancels owned waiter/timer
registrations, updates scoped-idle accounting, and appends the cancellation
event. This closes the existing stale-snapshot gap for both handle-bound and
name-bound cancellation.

`FlowHandle.cancel()` intentionally discards the public `CancelWorkResult` and
resolves to `void`, matching `cancelFlow()`. Name-bound
`crux.flows.cancel()` continues returning `CancelWorkResult` so callers that
operate without a handle can inspect whether they won the idempotent transition.

## Tests

Use vertical TDD slices through public interfaces:

1. Add a type contract proving `FlowHandle.cancel` accepts a flow id and returns
   `Promise<void>`; then add the minimal public type and implementation.
2. Add an object-bound behavior test proving the handle marks a suspended flow
   cancelled without a Runtime Engine.
3. Add a Runtime Engine behavior test proving the handle cancels durable work
   through the kernel and leaves the snapshot/work terminal.
4. Extend the shared store-composite conformance case to prove Runtime Engine
   cancellation atomically terminalizes the flow snapshot across memory,
   Postgres, and Convex-backed stores.
5. Test the handle's missing-id no-op without and with a Runtime Engine, while
   preserving strict missing-id behavior for `crux.flows.cancel()`.

Existing Runtime Engine conformance tests continue to cover cancellation
idempotency, waiter/timer races, and scoped-idle accounting.

## Documentation and release

Update the flow reference to include the handle method. Correct all stale
`run({ resume })` guidance. Expand the Runtime Engine reference to explain that
`defer`/`after` calls are positionally identified in the replay fingerprint,
become durable only at the next suspension/completion barrier, and create child
work that is not cancelled with its parent.

Add a minor changeset for `@use-crux/core`, because the new handle method is a
public additive API. No cache identity changes are needed: cancellation does not
change Project Index output, semantic facts, Runtime Engine snapshot shape, or
Quality replay identity.
