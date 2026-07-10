# RFC: Effects, receipts, recovery, and rollback

Status: **proposed**

Related: #131 (Workspace namespace snapshots and restore), #110 (Workspace
transactions), #106 (Workspace versioning and history), Runtime Engine, canonical
observability graph, Devtools run detail.

## Summary

Crux should make agent-caused state changes attributable, reviewable, and recoverable
without asking users to build a governance framework around every tool or workflow.

This RFC introduces one definition primitive plus recovery/rollback operations:

```ts
import {
  effect,
  recover,
  reconcileEffect,
  rollback,
  rollbackOnError,
  EffectOutcomeUnknownError,
} from '@use-crux/core/effect'
```

`effect()` defines a custom state transition as a normal callable. `recover()` handles
one receipt, `rollback()` handles a scope, `rollbackOnError()` creates a failure
boundary, and `reconcileEffect()` resolves a confirmed ambiguous outcome.

Crux-native mutations, such as Workspace writes, memory writes, and task updates,
contribute effects automatically. Tools, flow steps, pipelines, agents, and
compositions collect nested effects automatically. Users do not repeat effect
metadata at every call site.

An effect may optionally describe a resource and a recovery operation. Recovery is a
new, auditable state transition; it never erases the original receipt. A scope rolls
back registered recovery units in causal reverse order, coalescing shared native
checkpoints such as one Workspace namespace snapshot covering several file mutations.

The basic API works in-process without the Runtime Engine. A `RecordStore` makes
receipts and JSON-safe recovery envelopes durable. The Runtime Engine adds durable
suspension, post-restart recovery, target resolution, leases, retries, and crash-safe
continuation.

## Non-goals

- ACID transactions across systems or a promise that every action is reversible.
- Backup, disaster recovery, or replacements for Workspace transactions/history,
  namespace snapshots, observability, authorization, or identity.
- Inferring safe recovery from unmarked JavaScript or granting agents recovery access.
- Silently retrying unknown outcomes or rewriting history to erase an effect.

## Terminology

### Effect

An intentional change to durable or external domain state, such as a Workspace write,
CRM update, charge, task transition, or email. Reads, model work, validation, routing,
telemetry, caches, Runtime leases, and other bookkeeping are not domain effects.

### Native effect

A public Crux mutation. It keeps its native identity, such as `workspace.operation`,
while exposing the shared effect contract.

### Custom effect

Application code defined with `effect()` and represented by the generic primitive.

### Receipt

The immutable logical record of an attempt: identity, cause, resource, timing, status,
approval, and recovery availability. Sensitive payloads are stored separately.

### Recovery

An exact restore, version reversal, or compensating action that mitigates one effect;
it does not promise to restore the whole world to a prior instant.

### Effect scope

A causal group beneath a tool, step, pipeline, flow, agent, composition, or explicit
scope, used for explanation and aggregation.

### Rollback boundary

A scope owning a recovery stack and native checkpoints. Run-like roots and
`rollbackOnError()` are boundaries; nested grouping scopes normally share the nearest.

### Recovery unit

One recovery-stack entry, covering one custom effect or native effects that share an
anchor such as a Workspace snapshot.

### Resource

An optional stable affected-domain identity, such as `customer:cust_123` or a
Workspace namespace, used for review, policy, conflicts, coalescing, and concurrency.

## Public exports

The canonical module is singular, matching existing domain subpaths such as `/flow`
and `/workspace`:

```ts
import {
  effect,
  recover,
  reconcileEffect,
  rollback,
  rollbackOnError,
  EffectOutcomeUnknownError,
  RollbackError,
  type CapturedRecoverableEffectOptions,
  type EffectDefinition,
  type EffectExecutionResult,
  type EffectOptions,
  type EffectReceiptRef,
  type EffectScopeRef,
  type RecoverableEffectOptions,
  type RollbackResult,
} from '@use-crux/core/effect'
```

The stable public values and types are also re-exported from `@use-crux/core`.

`effect.rollback()` and `effect.rollbackOnError()` are rejected because scope
orchestration does not belong on the definition factory; named exports also tree-shake.

## `effect()`

### Simple definition

```ts
const sendEmail = effect(
  'email.send',
  async (input: SendEmailInput) => email.send(input),
)

const result = await sendEmail(input)
```

The returned definition is callable and preserves the executor's input/output types.
Calling it directly, through a tool, from a flow step, or from a pipeline function has
the same effect semantics.

### Recoverable from input/output

```ts
const chargeCustomer = effect(
  'payments.charge',
  async (input: ChargeInput, context) =>
    payments.charge(input, {
      idempotencyKey: context.idempotencyKey,
    }),
  {
    resource: ({ orderId }) => ({
      type: 'order',
      id: orderId,
    }),
    recover: async ({ input, output }) => {
      await payments.refund({
        chargeId: output.chargeId,
        reason: `Rollback for order ${input.orderId}`,
      })
    },
  },
)
```

The optional second executor argument supplies execution infrastructure without
requiring it at ordinary call sites. One-argument functions remain valid.

### Recovery requiring pre-state

```ts
const updateCustomer = effect(
  'crm.customer.update',
  async (input: UpdateCustomerInput) =>
    crm.updateCustomer(input.customerId, input.changes),
  {
    resource: ({ customerId }) => ({
      type: 'customer',
      id: customerId,
    }),
    recover: {
      capture: async ({ input }) =>
        crm.getCustomer(input.customerId),
      execute: async ({ captured }) => {
        await crm.restoreCustomer(captured)
      },
    },
  },
)
```

`capture` runs before the effect executor. If capture fails, the effect does not run.
Capture is required only when recovery needs state that the effect would overwrite or
delete. It is orthogonal to Runtime configuration: Runtime can persist old state, but
cannot reconstruct state that was never captured.

### Proposed types

```ts
type Awaitable<T> = T | PromiseLike<T>

interface EffectExecutionContext {
  /** Stable for one logical effect occurrence across Runtime replay/retry. */
  readonly idempotencyKey: string
  /** Aborted when the owning scope is cancelled before outcome is known. */
  readonly signal?: AbortSignal
  readonly receiptId: string
  readonly scope: EffectScopeRef
}

interface EffectReceiptRef {
  readonly kind: 'effect.receipt'
  readonly id: string
  readonly effectId: string
}

interface EffectExecutionResult<TOutput> {
  readonly output: TOutput
  readonly receipt: EffectReceiptRef
}

interface EffectResource {
  readonly type: string
  readonly id?: string
  readonly namespace?: string
  readonly attributes?: Readonly<Record<string, string | number | boolean>>
}

interface EffectRecoveryContext<TInput, TOutput> {
  readonly input: TInput
  readonly output: TOutput
  readonly receipt: EffectReceiptRef
  readonly resource?: EffectResource | readonly EffectResource[]
  /** Stable for this recovery unit across retries; not the execution key. */
  readonly idempotencyKey: string
  readonly conflict: 'fail' | 'force'
  readonly signal?: AbortSignal
}

interface EffectCaptureContext<TInput> {
  readonly input: TInput
  readonly receipt: EffectReceiptRef
  readonly signal?: AbortSignal
}

interface CapturedEffectRecoveryContext<TInput, TOutput, TCaptured>
  extends EffectRecoveryContext<TInput, TOutput> {
  readonly captured: TCaptured
}

interface EffectOptions<TInput> {
  /** Recovery/output replay contract version. Defaults to 1. */
  readonly version?: number
  readonly resource?: (
    input: TInput,
  ) => EffectResource | readonly EffectResource[] | undefined
}

interface RecoverableEffectOptions<TInput, TOutput>
  extends EffectOptions<TInput> {
  readonly recover: (
    context: EffectRecoveryContext<TInput, TOutput>,
  ) => Awaitable<void>
}

interface CapturedRecoverableEffectOptions<TInput, TOutput, TCaptured>
  extends EffectOptions<TInput> {
  readonly recover: {
    readonly capture: (
      context: EffectCaptureContext<TInput>,
    ) => Awaitable<TCaptured>
    readonly execute: (
      context: CapturedEffectRecoveryContext<TInput, TOutput, TCaptured>,
    ) => Awaitable<void>
  }
}

type EffectCallArgs<TInput> = [TInput] extends [void]
  ? [] | [input: TInput]
  : [input: TInput]

type EffectExecutor<TInput, TOutput> = (
  input: TInput,
  context: EffectExecutionContext,
) => Awaitable<TOutput>

interface EffectDefinition<TInput, TOutput> {
  (...args: EffectCallArgs<TInput>): Promise<TOutput>
  readonly id: string
  readonly version: number
  readonly _tag: 'EffectDefinition'
  run(...args: EffectCallArgs<TInput>): Promise<EffectExecutionResult<TOutput>>
}

interface RecoverableEffectDefinition<TInput, TOutput>
  extends EffectDefinition<TInput, TOutput> {
  recover(
    receipt: EffectReceiptRef,
    options?: RecoverOptions,
  ): Promise<RecoveryUnitResult>
}

function effect<TOutput, TCaptured, TInput = void>(
  id: string,
  execute: EffectExecutor<TInput, TOutput>,
  options: CapturedRecoverableEffectOptions<TInput, TOutput, TCaptured>,
): RecoverableEffectDefinition<TInput, TOutput>

function effect<TOutput, TInput = void>(
  id: string,
  execute: EffectExecutor<TInput, TOutput>,
  options: RecoverableEffectOptions<TInput, TOutput>,
): RecoverableEffectDefinition<TInput, TOutput>

function effect<TOutput, TInput = void>(
  id: string,
  execute: EffectExecutor<TInput, TOutput>,
  options?: EffectOptions<TInput>,
): EffectDefinition<TInput, TOutput>
```

Recoverable overloads precede the base so extracted required recovery retains
`.recover()`. Capture infers its state; extracted options can use `satisfies
CapturedRecoverableEffectOptions<...>`. Type tests lock inline/extracted options,
unannotated async capture, no-input effects, and tool/flow/pipeline compatibility.

`.run()` is the advanced path for an individual receipt; the callable form returns the
ordinary output. Standalone `recover(receipt)` remains canonical; the definition
method validates the effect id and delegates.

### Stable ids

The id is required. Function names are not stable under minification, aliases, or
bundling, and runtime recovery needs a durable identity. Ids use dotted domain naming
(`payments.charge`, `crm.customer.update`). Definition and target identity is the pair
`(id, version)`. One compiled project may deploy several versions of the same id, but
only one definition per pair; conflicting duplicates are a Project Index diagnostic
and Runtime preflight error. Identical re-exports collapse to one target. Version
defaults to `1` and is persisted with outputs/envelopes; authors increment it when
replay or recovery data compatibility breaks. Runtime resolves the exact pair.

### Resource projection

`resource` is optional. It should return the smallest stable, non-secret identity that
makes the effect understandable and conflict-checkable. The projection runs before
execution. A thrown projection error fails closed before the effect runs because a
definition must not silently lose a policy or conflict boundary.

The exact resource value is available to local/domain Devtools views subject to
capture policy. OTel export uses safe attributes or hashes and never exports raw
Workspace paths under this feature.

### What is deliberately not on `effect()`

Effect definitions do not own retries, timeouts, approval requirements, risk levels,
retention, storage selection, automatic rollback policy, or authorization. Those vary
by environment and call context and belong to container/runtime/policy configuration.
Stable ids and resources are the selectors those policies use.

## Tool integration

```ts
const updateCustomerTool = tool({
  description: 'Update a CRM customer',
  input: updateCustomerSchema,
  execute: updateCustomer,
})
```

No tool-specific effect metadata is required. The graph contains the tool call and the
nested effect:

```text
tool.call: updateCustomer
└── effect: crm.customer.update
```

Generated Crux tools call native primitives, so the native mutation supplies the
effect:

```text
tool.call: writeWorkspaceFile
└── workspace.operation: write [effect]
```

An arbitrary custom tool whose executor is not an `effect()` remains observable as a
tool call, but Crux does not infer that it mutates state. Project Index may later lint
obvious write-capable tools that lack an effect definition; it must not change runtime
semantics through heuristic inference.

## Scope model

### Automatic scopes

The following are effect scopes without new authoring syntax:

- tool calls;
- flow steps and flow runs;
- pipeline steps and pipeline runs;
- agent runs;
- parallel, branch, consensus, swarm, fallback, delegate, and handoff compositions;
- Runtime task execution;
- explicit `rollbackOnError()` callbacks.

Scopes aggregate descendants for receipts and Devtools. A container is not itself an
effect merely because it is a scope. A reviewer agent that only reads state and returns
a decision contributes no effect.

There are no rootless effect receipts. A direct custom effect or native mutation with
no active scope creates an implicit one-operation root scope and rollback boundary.
Its receipt therefore has valid `scopeId`/`boundaryId`, and `.run()` can return the
individual receipt. The implicit boundary is ephemeral unless persistence is
configured. It is not a managed multi-effect boundary and does not trigger a
Workspace namespace snapshot; direct Workspace operations use retained per-file
history where sufficient and otherwise report recovery unavailable.

### Rollback boundaries

Run-like roots and `rollbackOnError()` own recovery stacks. Nested grouping scopes
inherit the nearest boundary unless they explicitly establish another rollback
boundary. This prevents one Workspace snapshot per flow step while preserving the
step hierarchy in the graph.

```text
Flow run                         rollback boundary
├── Flow step                    grouping scope
│   └── Workspace write          recovery unit on Flow boundary
├── Flow step                    grouping scope
│   └── CRM update               recovery unit on Flow boundary
└── Reviewer step                grouping scope, no effects
```

A nested `rollbackOnError()` establishes an independent boundary and native
checkpoints relative to its entry state:

```ts
await flow.step('optional-update', () =>
  rollbackOnError(async () => {
    await ws.write('/outputs/optional.md', content)
    await updateSearchIndex(input)
  }),
)
```

If the nested boundary rolls back, its Workspace snapshot returns to the state at the
start of the nested block. If it succeeds and the outer flow later rolls back, the
outer snapshot returns to the state before the flow. Recovery units already recovered
by a child are idempotently skipped by an outer rollback.

### Effect-scope references on results

Run-like result types gain an opaque, JSON-safe reference:

```ts
interface EffectScopeRef {
  readonly kind: 'effect.scope'
  readonly id: string
  readonly runId: string
}
```

```ts
flowResult.effects
pipelineResult.effects
agentResult.effects
compositionResult.effects
```

The discriminant lets server handlers validate round-tripped JSON and distinguish a
scope from a receipt before storage lookup. The reference contains no input, output,
captured state, path, or secret. It can be returned through an API and later passed
back to a trusted server handler.

Tools and direct `effect()` calls preserve their existing return value. They do not
wrap outputs in `{ value, receipt }`. Individual receipt refs are available from
observability/receipt hooks and Devtools when advanced code needs them.

## `rollbackOnError()`

### Default complete-recovery mode

```ts
const customer = await rollbackOnError(async () => {
  const customer = await createCustomer(input)
  await chargeCustomer(customer)
  await scheduleWelcomeEmail(customer)
  return customer
})
```

If the callback throws, completed recovery units are recovered in causal reverse
order. A completed rollback rethrows the original error unchanged. A partial, failed,
cancelled, or impossible rollback throws `RollbackError` with the original error as
`cause` and the `RollbackResult` attached as `result`.

By default, `rollbackOnError()` requires every encountered effect to be recoverable.
An effect without recovery fails before its executor runs:

```ts
await rollbackOnError(async () => {
  await sendEmail(input) // blocked if email.send has no recovery
})
```

This makes the function's name an honest guarantee instead of “attempt rollback when
convenient.” Best-effort behavior is explicit:

```ts
await rollbackOnError(
  async () => {
    await updateCustomer(input)
    await sendEmail(input)
  },
  { recovery: 'best-effort' },
)
```

Proposed shape:

```ts
interface RollbackBoundaryController {
  readonly ref: EffectScopeRef
  rollback(options?: RollbackOptions): Promise<RollbackResult>
}

interface RollbackOnErrorOptions {
  readonly recovery?: 'required' | 'best-effort'
}

class RollbackError extends Error {
  readonly result?: RollbackResult
  readonly recoveryError?: unknown
  readonly cause?: unknown
}

function rollbackOnError<T>(
  run: (scope: RollbackBoundaryController) => Awaitable<T>,
  options?: RollbackOnErrorOptions,
): Promise<T>
```

`recovery` defaults to `'required'`. The option describes the boundary's recovery
guarantee: required mode blocks an effect without available recovery before its
executor runs; best-effort mode records irreversible or unavailable effects and may
produce a partial rollback.

### Programmatic rejection inside the callback

```ts
const result = await rollbackOnError(async (scope) => {
  await updateCustomer(input)
  await publishReport(input)

  const review = await reviewChanges(input)
  if (!review.approved) {
    await scope.rollback({ reason: review.reason })
    return { status: 'rejected' as const }
  }

  return { status: 'approved' as const }
})
```

After `scope.rollback()` begins, the boundary is terminal. Starting another effect in
that boundary throws `EFFECT_SCOPE_TERMINAL`; pure computation may finish so the
caller can return a rejection result.

`scope.rollback()` returns expected unit outcomes as `RollbackResult`. Before the
wrapper resolves the callback value, it enforces its mode against that result:

- required mode resolves only after `completed`; otherwise it throws `RollbackError`
  with the result attached and no `cause` when the callback returned normally;
- best-effort mode permits the callback to return after any terminal rollback result;
- if the callback throws after a manual rollback, a completed rollback rethrows that
  error unchanged, while any incomplete rollback throws `RollbackError` with the
  callback error as `cause`;
- a recovery failure before any result rejects `scope.rollback()` and is recorded as
  `recoveryError`; it still makes the wrapper throw `RollbackError` if the callback
  catches it and returns, and any later callback error is preserved as `cause`.

The last rule also applies to automatic rollback: a tracked pre-result recovery error
wins over callback completion. This keeps result semantics consistent without letting
an ignored or caught recovery failure satisfy a boundary.

## `rollback()`

```ts
const result = await rollback(flowResult.effects, {
  reason: 'Customer rejected the publication',
})
```

Proposed types:

```ts
interface RollbackOptions {
  readonly reason?: string
  readonly conflict?: 'fail' | 'force'
  readonly signal?: AbortSignal
}

type RecoveryUnitStatus =
  | 'recovered'
  | 'already_recovered'
  | 'unavailable'
  | 'irreversible'
  | 'expired'
  | 'conflict'
  | 'handler_unavailable'
  | 'ambiguous'
  | 'failed'
  | 'cancelled'

interface RecoveryUnitResult {
  readonly unitId: string
  readonly effectIds: readonly string[]
  readonly resource?: EffectResource | readonly EffectResource[]
  readonly status: RecoveryUnitStatus
  readonly error?: {
    readonly code: string
    readonly message: string
  }
}

interface RollbackResult {
  readonly scope: EffectScopeRef
  readonly status:
    | 'completed'
    | 'partial'
    | 'not_possible'
    | 'failed'
    | 'cancelled'
  readonly units: readonly RecoveryUnitResult[]
  readonly startedAt: number
  readonly completedAt: number
}
```

`rollback()` attempts every safe recoverable unit even if one recovery fails.
Aggregate status uses this precedence:

1. `completed` for an empty plan or when every unit is `recovered` or
   `already_recovered`.
2. `cancelled` when cancellation leaves any planned unit unsettled.
3. `partial` when at least one unit succeeded and at least one terminal unit did not.
4. `failed` when no unit succeeded and at least one attempted recovery failed.
5. `not_possible` when no unit succeeded or failed because every unit was blocked as
   unavailable, irreversible, expired, conflicted, handler-unavailable, or ambiguous.

Thus recovered-plus-expired is `partial`, failed-plus-conflict is `failed`, and a
cancelled plan cannot masquerade as a terminal partial result. Unavailable scope refs
throw before recovery; expected unit outcomes are data.

`conflict` defaults to `'fail'`. Force recovery is an elevated operation subject to
authorization and approval policy.

## Individual recovery

A caller obtains an individual receipt without changing the normal return shape:

```ts
const execution = await updateCustomer.run(input)

await recover(execution.receipt, {
  reason: 'Operator rejected the change',
})
```

```ts
interface RecoverOptions extends RollbackOptions {}

function recover(
  receipt: EffectReceiptRef,
  options?: RecoverOptions,
): Promise<RecoveryUnitResult>
```

The equivalent definition convenience is:

```ts
await updateCustomer.recover(execution.receipt, { reason })
```

`recover(receipt)` resolves the receipt's recovery unit. It succeeds only when that
unit covers the one receipt. If a native unit covers several receipts—for example,
several Workspace writes sharing one snapshot—individual recovery rejects with
`EFFECT_RECOVERY_SHARED_UNIT` and identifies the owning scope and covered receipts. It
must never surprise the caller by restoring siblings. Recover shared units through
scope rollback, where the complete plan and dependencies are visible.

For a custom single-receipt unit, this invokes only that definition's recovery, not
its siblings or parent scope. It is primarily useful in application/operator code.
Devtools and run-level behavior should prefer scope rollback.

An individual effect that called nested effects owns only its direct state:

```ts
const publishCampaign = effect(
  'campaign.publish',
  async (input) => {
    await uploadAssets(input)
    await updateSearchIndex(input)
    return publishCampaignRecord(input)
  },
  { recover: unpublishCampaignRecord },
)
```

Rollback order is parent direct recovery, search recovery, then upload recovery because
the parent completes after its children. `unpublishCampaignRecord` must not also
recover the child effects. If one external call owns the whole compound operation and
one recovery handler compensates it, the internal calls should remain ordinary
functions rather than separately marked effects. This prevents double recovery.

## Flow integration

Every flow run is a durable-capable rollback boundary and exposes `flow.rollback()`
inside the handler:

```ts
const publication = flow('publication', async (flow, input) => {
  await flow.step('write', () =>
    ws.write('/outputs/report.md', input.report),
  )

  await flow.step('publish', () =>
    publishArticle(input.article),
  )

  const review = await flow.step('review', () =>
    reviewer.run(input),
  )

  if (!review.approved) {
    await flow.rollback({ reason: review.reason })
    return { status: 'rejected' as const }
  }

  return { status: 'published' as const }
})
```

`FlowScope` gains:

```ts
interface FlowScope<...> {
  // existing members
  readonly effects: EffectScopeRef
  rollback(options?: RollbackOptions): Promise<RollbackResult>
}
```

The returned `FlowResult` variants all include `effects` once a flow id has been
allocated, including suspended/cancelled/expired results. A cancelled or expired flow
does not automatically roll back unless configured by an explicit policy; its effects
remain reviewable.

### Delayed human review

```ts
const publication = flow(
  'publication',
  {
    signals: {
      review: z.object({
        approved: z.boolean(),
        reason: z.string().optional(),
      }),
    },
  },
  async (flow, input) => {
    await flow.step('publish', () => publishReport(input))

    const decision = await flow.suspend('review')
    if (!decision.approved) {
      await flow.rollback({
        reason: decision.reason ?? 'Human rejected publication',
      })
    }

    return decision
  },
)
```

Suspend/resume already requires Runtime persistence. The flow snapshot stores the
effect-scope ref, not full recovery payloads. Recovery envelopes remain in their own
retained records.

### Recovery after flow completion

The generic API is canonical:

```ts
const result = await publication.run(input)
await rollback(result.effects, { reason: 'Rejected after publication' })
```

## Pipeline, agent, and composition integration

Pipeline, agent, and composition roots are rollback boundaries. Their nested steps,
branches, delegates, and tool calls are grouping scopes. Results expose the same
`effects` ref:

```ts
const result = await pipeline({ context, steps, model })

await rollback(result.effects, {
  reason: 'Reviewer rejected the generated deliverable',
})
```

Immediate pipelines do not need Runtime for current-process rollback. Delayed recovery
of `result.effects` requires durable receipt storage and addressable recovery handlers;
the Runtime path is the supported production guarantee.

## Native effect contract

Every public Crux operation that intentionally mutates durable or external domain
state contributes an effect automatically. Native subsystems internally implement an
equivalent of:

```ts
interface NativeEffectProvider<TOperation, TRecoveryRef> {
  describe(operation: TOperation): NativeEffectDescription

  prepareRecovery?(
    operation: TOperation,
    boundary: EffectScopeRef,
  ): Promise<TRecoveryRef | undefined>

  recover(
    reference: TRecoveryRef,
    context: NativeRecoveryContext,
  ): Promise<void>
}
```

This is an internal compiler/runtime contract, not a public plugin registry. Native
providers use explicit first-party manifests and imports. Custom users use `effect()`.

The initial native matrix is:

| Domain | Effectful operations | V1 recovery |
| --- | --- | --- |
| Workspace | write/edit/append/delete/rename/move/copy/finalize/transaction/restore | File version for isolated content changes; shared namespace/subtree snapshot for rollback boundaries. |
| Memory | durable write/update/accept proposal/delete/compaction replacement | Superseding prior revision when retained; never erase history. |
| Plan | create/update/delete or structural revision | Restore/supersede prior plan revision when retained. |
| Task | create/update/status transition/delete | Restore/supersede prior task record when retained. |
| Blackboard | durable set/delete | Restore prior value or absence. |
| Handoff | durable send/transfer/revoke | Cancel or revoke while unconsumed; consumed handoff is irreversible. |
| Corpus/index source | public source upsert/delete/sync mutation | Audit-first; recover only when a prior source revision is retained. Derived reindexing is not a domain effect. |
| Quality/feedback | baseline promotion, durable feedback/insight status mutation | Audit-first unless the domain already exposes a safe superseding operation. |

Read APIs, retrieval, generation, scoring, validation, routing, cache lookup/population,
telemetry delivery, Runtime leases, waiter/event bookkeeping, and Project Index cache
writes do not become domain effects.

Native coverage is capability-based. A receipt may legitimately report
`irreversible` or `unavailable` until that domain owns a safe recovery
strategy. Native integration must never call a generic “write the old JSON back” path
that bypasses domain invariants.

## Workspace recovery

Workspace is the reference native implementation because it already owns always-on
per-file history, transactions, blobs, namespace identity, and operation
instrumentation. #131 supplies the missing namespace snapshot primitive.

### Individual operations

An isolated content mutation can use existing version history when the previous
version is retained:

```text
workspace.operation: write /report.md
recovery: restore version 4 as a new version 6
```

Recovery appends history just like `undo()`. It never rewrites version records.

Delete, rename/move, copy, multi-file transaction, and exact namespace-set recovery
need richer state than one content revision. Inside a rollback boundary they use a
namespace or subtree snapshot.

### Lazy boundary snapshot

On the first mutation of a contiguous Workspace segment within a rollback boundary,
Crux creates a consistent snapshot before applying the mutation:

```text
Flow boundary
├── prepare Workspace recovery: snap_123
├── write /outputs/report.md
├── delete /outputs/old.csv
└── write /outputs/index.json
```

The snapshot is registered once under a provider-owned recovery key such as:

```text
workspace:<workspaceId>:<namespace>:<snapshotPath>
```

Later contiguous mutations under the same boundary/path attach to that unit. A
segment remains open only while every subsequently registered recovery unit is
covered by the same snapshot anchor. Any intervening uncovered unit—including a
Workspace mutation on a disjoint path—closes it; a later mutation captures a new
snapshot of then-current state. Thus `/a → /b → /a` normally creates A1, B, then A2,
unless one exact namespace snapshot validly covers all three. This preserves reverse
causal order without pretending a partial snapshot covers unrelated paths.

The snapshot reference is metadata-only:

```ts
interface WorkspaceSnapshotRecoveryRef {
  readonly kind: 'workspace.snapshot'
  readonly snapshotId: string
  readonly workspaceId: string
  readonly namespace: string
  readonly path: string
  readonly capturedHeadFingerprint: string
  readonly expectedCurrentFingerprint?: string
}
```

Exact public snapshot types remain owned by #131. This RFC requires enough identity
and head fingerprints for retention and conflict-safe restore.

### Snapshot boundary selection

The default boundary is the narrowest stable native boundary that can guarantee exact
restore:

1. An explicitly configured Workspace recovery path, when present.
2. The local mount root that contains the first mutation, when all later covered
   mutations remain under it.
3. The Workspace namespace root when mutations span local mount roots.

If a later mutation falls outside an existing snapshot path, Crux creates another
recovery unit for the disjoint path or promotes to a namespace snapshot only when the
store can do so without losing the already captured pre-boundary state. It must never
silently claim that one partial snapshot covers unrelated paths.

Source-backed/virtual mount mutations are recoverable only when their source provider
declares compatible recovery semantics. Otherwise they are irreversible within the
scope and a `rollbackOnError({ recovery: 'required' })` boundary blocks before
mutation.

### Snapshot defaults and opt-out

- Per-file Workspace history remains always on, with its existing retention controls.
- Namespace/subtree snapshots are lazy and automatic inside rollback boundaries when
  supported.
- Direct Workspace mutations outside a managed multi-effect boundary do not create a
  namespace snapshot; their implicit one-operation boundary still produces a receipt
  and uses file history where applicable.
- A Workspace may explicitly opt out of automatic scope snapshots for cost-sensitive
  workloads, for example `workspace({ recovery: false })`.
- `rollbackOnError({ recovery: 'required' })` fails before a Workspace mutation when
  the required recovery capability is disabled or unsupported.
- Ordinary flow/agent/pipeline scopes permit partial recovery and expose unsupported
  effects honestly unless a higher policy requires full recoverability.

The exact configuration spelling should remain one concise opt-out or policy override;
users must not configure snapshot creation at every write call.

### Workspace rollback planning and coalescing

Given:

```text
1. workspace write report.md   → snapshot A
2. CRM update                  → recovery C
3. workspace delete old.csv    → snapshot B
```

the boundary recovery stack is:

```text
1. Workspace restore A (covers operation 1)
2. CRM recovery C
3. Workspace restore B (covers operation 3)
```

Rollback executes:

```text
1. Workspace restore B
2. CRM recovery C
3. Workspace restore A
```

Contiguous Workspace operations—such as several writes inside one transaction or
sequential calls covered by the same anchor with no intervening uncovered unit—share
one snapshot. The planner never coalesces across an uncovered recovery unit because
that would move a later compensation across a causal dependency.

The planner must not mix a shared namespace restore with individual per-file undo for
covered operations. Restoring A once marks all covered Workspace effect receipts as
recovered.

### Trigger paths

Users may trigger the same native restore through:

```ts
await flow.rollback({ reason })
await rollback(result.effects, { reason })
```

The low-level explicit Workspace API remains:

```ts
const snapshot = await ws.snapshot({ path: '/outputs' })
await ws.restore(snapshot)
```

The general rollback paths resolve the stored native recovery reference and call the
same Workspace restore implementation. Users do not manually locate snapshot refs for
normal run recovery.

`workspace.restore` is itself a native Workspace effect executed in a dedicated
recovery scope and linked to all covered originals. It must not register itself back
onto the boundary being recovered.

### Snapshot retention and blobs

An available effect receipt pins the snapshot and every file-version/blob reference
required to restore it. Workspace version GC and blob GC must not delete pinned
content. Scope/recovery retention releases those pins. Quota calculations distinguish
live files, ordinary history, and recovery-pinned snapshot data. Expired recovery is
reported as `expired`, never discovered only after the operator presses Restore.

## Memory, plan, task, and blackboard recovery

Native record domains recover through their own revision/state-transition APIs:

- Memory recovery appends a superseding revision or restores the previous retained
  revision. It does not delete the original write receipt.
- Task recovery performs a validated reverse transition or restores a prior record.
  It must honor task invariants and current-state conflict checks.
- Plan recovery restores a prior structural revision through the plan domain API.
- Blackboard recovery restores the prior value or prior absence for the key.

Each provider captures an expected post-effect version. If another actor changes the
same resource after the effect, default rollback reports a conflict instead of
clobbering newer state.

## Handoff recovery

Handoff state is time-sensitive:

- A queued/unconsumed handoff may be cancelled or revoked.
- A consumed handoff may not be reversible because another agent can already have
  acted on the information.
- Revoking future authority is distinct from undoing past action.

Receipts transition recovery availability as the handoff lifecycle advances. An
effect that was recoverable at creation may become irreversible after consumption;
Devtools and rollback preview must show current availability, not only the original
capability.

## Recovery ordering

### Append-only recovery stack

Each rollback boundary owns an append-only logical stack of recovery units. Units are
registered through execution, not reconstructed later from wall-clock timestamps.

For a recoverable custom effect without pre-capture, the unit becomes recoverable when
execution succeeds and its output/recovery envelope is retained. With `capture`, a
prepared record is durable before execution and becomes active when success is
recorded. Native providers may register one prepared unit at the first covered
mutation, as Workspace snapshots do.

Sequential rollback is last-in, first-out.

### Nested scopes

Nested scopes are represented as a causal tree. A completed child rollback boundary is
one unit in its parent; rolling it back recursively traverses its own stack:

```text
Outer boundary
├── Workspace recovery
├── Child pipeline boundary
│   ├── Customer recovery
│   └── Scheduled-email recovery
└── Task recovery
```

Rollback order:

```text
1. Recover task
2. Roll back child pipeline
   2a. Cancel scheduled email
   2b. Restore customer
3. Restore Workspace
```

Grouping scopes that are not rollback boundaries do not introduce recovery-stack
entries; their descendant units register with the nearest boundary while retaining
scope ancestry for explanation.

### Nested custom effects

Nested custom effects register independently. If a parent effect has its own direct
recovery, it completes after its children and therefore recovers before them. Recovery
handlers own only direct state. The system detects and skips the same receipt/unit id,
but cannot prove that application code did not manually duplicate a child
compensation; documentation and lint guidance must make this invariant explicit.

### Parallel branches

Parallel rollback is based on the causal dependency graph and resource identity:

1. Stop scheduling new branch work.
2. Request cancellation for in-flight cancellable effects.
3. Wait for each in-flight effect to reach a known terminal or ambiguous outcome.
4. Reverse explicit dependency edges and sequential order within each branch.
5. Recover independent branches concurrently only when their recovery units have
   disjoint resources/providers and the provider declares parallel recovery safe.
6. Serialize or coalesce units sharing a resource key.
7. Use a deterministic recorded sequence as the final tie-breaker, never wall-clock
   timestamps alone.

V1 may conservatively serialize parallel branch recovery. It must preserve the causal
model and result shape so safe concurrency can be added without changing semantics.

### Retries

Retries are attempts of one logical effect occurrence:

```text
payments.charge
├── attempt 1 failed
└── attempt 2 succeeded
```

Only the successful logical effect registers one recovery unit. Its generated
`idempotencyKey` remains stable across attempts. Recovery has its own stable key so a
retried refund/restore does not execute twice when the external provider honors
idempotency.

Occurrence identity is `(boundary id, deterministic scope path, effect id, effect
version, occurrence index)`. The index advances for repeated calls/loops and is
replayed in the same deterministic order. Step retries reuse the same identities. In
a Runtime replay, a previously succeeded occurrence returns its retained JSON-safe
output instead of invoking the executor again. A changed id, version, order, or count
produces replay divergence rather than reusing incompatible output or executing new
external work. Durable Runtime effects therefore require replayable output or an
effect-specific native result reference.

### Repeated rollback

Rollback is idempotent at the receipt/unit layer:

- recovered units return `already_recovered`;
- concurrent recovery requests join the same Runtime work/lease and await one terminal
  result;
- failed units may be retried;
- successful sibling units are not repeated;
- an outer rollback skips child units already recovered by an inner boundary.

## Receipts and persisted state

Receipt metadata and recovery envelopes are separate records so Devtools and audit
queries do not load sensitive recovery state.

### Effect receipt

```ts
type EffectOutcome =
  | 'preparing'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown'

type RecoveryAvailability =
  | 'available'
  | 'unavailable'
  | 'irreversible'
  | 'expired'
  | 'conflict'
  | 'handler_unavailable'
  | 'ambiguous'
  | 'recovered'

interface EffectReceipt extends EffectReceiptRef {
  readonly schemaVersion: 1
  readonly effectVersion: number
  readonly effectKind: 'custom' | 'native'
  readonly nativePrimitive?: string
  readonly scopeId: string
  readonly boundaryId: string
  readonly parentReceiptId?: string
  readonly runId?: string
  readonly traceId?: string
  readonly spanId?: string
  readonly toolCallId?: string
  readonly flowId?: string
  readonly stepId?: string
  readonly actorId?: string
  readonly approvalId?: string
  readonly source?: {
    readonly definitionId?: string
    readonly sourceId?: string
    readonly sourceRef?: string
  }
  readonly resource?: EffectResource | readonly EffectResource[]
  readonly attemptCount: number
  readonly outcome: EffectOutcome
  readonly recovery: RecoveryAvailability
  readonly recoveryUnitId?: string
  readonly startedAt: number
  readonly completedAt?: number
  readonly error?: {
    readonly code: string
    readonly message: string
  }
}
```

Receipts are immutable facts or append-only transitions folded into this read model.
Adapters may store an event sequence or transactional state records, but observers
must see monotonic lifecycle transitions and stable ids.

### Recovery envelope

The envelope contains only data required to invoke recovery:

```ts
interface RecoveryEnvelope extends JsonObject {
  readonly schemaVersion: 1
  readonly receiptId: string
  readonly effectId: string
  readonly effectVersion: number
  readonly input?: JsonValue
  readonly output?: JsonValue
  readonly captured?: JsonValue
  readonly nativeRef?: JsonValue
  readonly createdAt: number
  readonly expiresAt?: number
}
```

For the simple recovery function, JSON-safe input/output form the default envelope.
For `capture + execute`, captured pre-state is added. Native providers store an opaque
JSON native reference instead of generic input/output when possible.

Recovery state is not an observability artifact and is never exported through OTel.
Devtools receives summaries/references, not raw captured state, unless a future
explicit privileged inspection API is designed.

If required state is not JSON-safe:

- current-process rollback may retain and use it ephemerally;
- the receipt reports that durable recovery is unavailable;
- a boundary requiring durable recovery fails before the effect when this can be
  established from input/capture;
- non-serializable output discovered after success yields an honest ambiguous or
  non-durable recovery state and a diagnostic.

A later compatible extension may add an explicit recovery-state projection/codec.
V1 should first use JSON-safe envelopes and native references rather than expose a
serializer API without concrete adapter requirements.

### Scope and recovery-unit records

Durable boundaries persist:

- scope id, parent id, run/flow identity, and terminal status;
- ordered recovery-unit registrations;
- unit-to-effect coverage;
- provider/resource keys;
- native/custom handler identity;
- prepared/active/recovering/recovered/failed lifecycle;
- conflict fingerprints and retention deadlines.

The scope ref is safe to serialize; these records are not embedded in model outputs.

## Crash consistency and ambiguous outcomes

No SDK can guarantee exactly-once effects across an arbitrary external system and a
separate receipt store. The contract must make the gap explicit.

Durable execution uses this sequence:

1. Resolve policy/resource and capture recovery state.
2. Durably record a prepared effect occurrence and stable idempotency key.
3. Invoke the effect.
4. Durably record output and success, activating the recovery unit.

A crash between steps 3 and 4 produces `outcome: 'unknown'`. Crux must not silently
retry or automatically compensate it unless:

- the external operation used the provided idempotency key and the provider can safely
  resolve/retry it; or
- a native provider has transactional evidence of the outcome.

Unknown effects are excluded from automatic rollback and reported as `ambiguous`
until reconciled. Devtools must offer inspect/reconcile guidance, not a misleading
Recover button.

Executors explicitly classify provider errors whose commit outcome is unknown:

```ts
throw new EffectOutcomeUnknownError('Payment provider timed out', {
  providerOperationId,
})
```

An authorized reconciliation operation resolves the receipt after querying the
provider or receiving operator evidence:

```ts
await reconcileEffect(receipt, {
  outcome: 'succeeded',
  output,
  reason: 'Provider confirms charge ch_123',
})

await reconcileEffect(receipt, {
  outcome: 'failed',
  reason: 'Provider confirms no charge was created',
})
```

```ts
type EffectReconciliation<TOutput extends JsonValue = JsonValue> =
  | { readonly outcome: 'succeeded'; readonly output: TOutput; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

function reconcileEffect(
  receipt: EffectReceiptRef,
  resolution: EffectReconciliation,
): Promise<EffectReceipt>
```

The receipt may identify an original attempt or a recovery attempt. Reconciliation is
audited, validates effect id/version, and activates recovery only when required
output/envelope data is supplied. Ordinary thrown errors mean known failure;
adapters/native providers may classify known timeout types, but arbitrary errors are
never guessed to be ambiguous.

Recovery attempts use the same prepared/running/succeeded/failed/unknown lifecycle.
A crash after an external compensation succeeds but before its success record is
`unknown`. Runtime never automatically retries an unknown custom recovery: supplying
an idempotency key does not prove the handler forwarded it. A first-party native
provider may resolve or retry only when its conformance contract supplies
transactional or idempotent evidence. Otherwise an authorized caller must reconcile
the recovery-attempt receipt through the same API.

Reconciling a recovery attempt as succeeded atomically marks the attempt succeeded,
its recovery unit recovered, and every original receipt covered by that unit
recovered. Reconciling it as failed marks the attempt failed and the unit active and
retryable. A known failed recovery may be retried under policy; an unknown one may
not.

Native operations backed by the same transactional store as receipts may atomically
record mutation and outcome. Generic `RecordStore` implementations must not claim
atomicity they do not provide.

## Conflict-safe recovery

Recovery must not silently overwrite changes made after the original effect.

Native providers record a post-effect version/fingerprint. Before recovery they check
that the current resource is still the state produced by the covered effect set. A
mismatch returns `conflict` without mutation.

For Workspace namespace restore, the provider compares the current namespace/subtree
head fingerprint with the expected fingerprint represented by the covered effect set.
Unrelated post-run changes under the restore path therefore block default restore.

```ts
await rollback(result.effects) // conflict: fail (default)

await rollback(result.effects, {
  conflict: 'force',
  reason: 'Approved operator restore',
})
```

Force recovery is separately authorized and audited. It never bypasses store
capability checks or snapshot validity.

Custom effects are responsible for enforcing domain-specific optimistic concurrency
inside their recovery handler. Crux supplies the requested conflict mode and resource
identity but cannot invent a version check for an arbitrary API. Project documentation
should recommend version/ETag-aware APIs and idempotent compensation.

## Runtime and persistence modes

| Setup | Guaranteed behavior |
| --- | --- |
| No configured store or Runtime | Callable effects, canonical observability, active-scope collection, `rollbackOnError()` and manual rollback in the current process. Receipts/recovery state are ephemeral. |
| `config({ persistence: { records } })` | Durable receipt/scope/envelope records where JSON-safe; later recovery may execute in a process where the definitions are already loaded. |
| Configured Runtime Engine | Durable boundaries, suspend/resume, target resolution, leases, recovery retries, post-restart recovery, remote/Devtools commands, retention maintenance, and crash-safe continuation. |

Runtime is an enhancement, not a requirement for `effect()` itself.

### Runtime handler resolution

Custom delayed recovery must resolve code from a stable effect id without a mutable
global registry or arbitrary string import.

Decision:

1. `effect()` definitions are first-class authored definitions discovered by Project
   Index.
2. In-process calls retain the actual definition object and need no lookup.
3. Runtime-capable builds expose exported recoverable effects through the same
   generated/bound Runtime target manifest used for durable flow/task targets.
4. `crux runtime generate` and host adapters include addressable effect recovery
   targets automatically; users do not maintain a second manual registry.
5. A dynamic/unexported effect can run and recover in-process but is not recoverable
   after restart. Project Index reports `effect.recovery_not_runtime_addressable` when
   durable usage is visible.
6. Missing or incompatible definitions produce `handler_unavailable`; Runtime never
   imports a package solely from receipt-controlled data.

Effect id+version is included in the receipt, envelope, and recovery target identity.
Runtime invokes only an exact version match. Changing the recovery/replay contract
requires incrementing `version`; old definitions must remain deployed or old receipts
must be explicitly migrated/expired. Function source hashes remain diagnostics, not a
compatibility promise.

## Privacy, retention, and lifecycle

Recovery data is operational state, not telemetry. Existing observability capture
settings continue to govern trace inputs/outputs; they do not redact a recovery
envelope into unusability.

V1 rules:

- Receipt metadata stores stable ids, statuses, relationships, safe resource
  summaries, hashes, and timing.
- Raw recovery input/output/captured state is stored only in the configured persistence
  substrate and never sent to OTel.
- At-rest encryption, tenancy, access control, and data locality are responsibilities
  of the configured store/host. Core cannot infer them.
- Effect/resource Project Index facts contain authored structure, never runtime values.
- Workspace paths remain hashed in OTel under the existing privacy contract.
- Recovery envelopes receive bounded retention. Native references pin underlying
  versions/blobs until expiry.
- Expiry changes availability to `expired`; receipt metadata remains according to
  audit retention.
- Pruning is bounded and adapter-conformant. It releases native pins only after no
  live recovery unit references them.
- A privileged application may explicitly delete receipts/recovery state to meet data
  deletion requirements, but deletion itself is audited and may make rollback
  unavailable.

The RFC does not introduce a universal encryption API. Host adapters should document
how their record stores protect sensitive recovery state. A future recovery-state
projection/codec can reduce stored material without changing the simple effect form.

## Policy, approval, and authorization

Effect definitions expose policy boundaries; they do not hardcode policy.

Policies may match:

- exact/glob effect id;
- native primitive and operation;
- resource type/namespace;
- recoverability/irreversibility;
- scope kind (tool, flow, agent, etc.);
- environment/actor information supplied by the host.

Approval happens before capture/execution unless policy explicitly needs the captured
summary. Denied effects produce approval evidence but no effect execution receipt.

Recovery is itself a governed action. Application code, Devtools, and agents do not
receive authority merely because a receipt exists. Host/application policy decides:

- who may preview rollback;
- who may recover one effect or a whole scope;
- whether force-conflict recovery requires approval;
- whether agents may receive a recovery tool;
- whether high-impact rollback needs multi-party approval.

V1 can integrate with existing approval middleware/event machinery by matching native
and custom effect identities. A broader `effectPolicy()` authoring API may be a
follow-up; it is not required to make the receipt/recovery model correct.

## Canonical observability graph

Effect is a cross-cutting facet, not a replacement for native primitive identity.

### Native effects

Do not emit duplicate generic nodes:

```text
Bad:
workspace.operation
└── effect.run

Good:
workspace.operation [effect]
```

Existing native spans/events gain canonical effect attributes/artifacts such as:

```ts
{
  primitive: 'workspace.operation',
  operation: 'write',
  effectId: 'workspace.file.write',
  effectScopeId: 'scope_123',
  effectReceiptId: 'effect_456',
  recovery: 'available',
}
```

Attribute naming must follow the canonical graph contract and OTel export conventions;
the exact `crux.*` wire names are specified with the schema change. Sensitive values
are safe/hashed.

### Custom effects

Custom effects use a new canonical primitive/family, for example `effect.run` in the
`effect` family:

```text
flow.step: update-customer
└── effect.run: crm.customer.update
```

### Relationships and artifacts

The canonical graph adds stable concepts for:

- scope membership/causality;
- effect receipt summary;
- recovery availability;
- `recovery.of` links from recovery attempts to original effects;
- one native recovery unit covering several effects;
- rollback run/scope result;
- ambiguous/conflict/partial outcomes.

Recovery envelopes are never observability artifacts.

### Example graph

```text
flow.run: publication
├── flow.step: prepare
│   └── workspace.operation: write [effect, recoverable]
├── flow.step: publish
│   └── effect.run: cms.article.publish [recoverable]
├── flow.step: notify
│   └── effect.run: email.send [irreversible]
└── flow.step: review
    └── agent.run
```

After rollback:

```text
recovery.run
├── effect.run: cms.article.unpublish
│   └── recovery.of cms.article.publish
└── workspace.operation: restore
    └── recovery.of workspace.operation: write
```

## Devtools experience

### Domain-first cards

Native effects keep native cards and gain consistent effect/recovery badges:

```text
Workspace · Write
/outputs/report.md
Succeeded · Recoverable
```

```text
Memory · Write
customer-preferences
Succeeded · Recoverable
```

```text
Task · Update
task_123 → completed
Succeeded · Recoverable
```

Custom definitions use a generic card:

```text
Effect · crm.customer.update
customer:cust_123
Succeeded · Recoverable
```

Badges/statuses include Recoverable, Irreversible, Recovered, Recovery failed,
Recovery expired, Conflict, Ambiguous, and Handler unavailable.

### Run recovery summary

Run detail shows an aggregate without replacing the timeline:

```text
Effects
5 completed · 4 recoverable · 1 irreversible

[Preview rollback]
```

Preview resolves current availability and conflict state:

```text
Will recover
  Workspace /outputs       restore snapshot
  CRM customer cust_123    restore version 7
  Scheduled email          cancel schedule

Cannot recover
  Email welcome.send       already delivered
```

The operator confirms the exact plan. Force-conflict recovery is a separate elevated
action, never the default button.

### Domain views

The normalized receipt read model projects into:

- Workspace file/namespace history with originating run and snapshot restore;
- Memory revision history and superseding recovery;
- Plan/task state history;
- run-level effect/recovery summary;
- a cross-domain Effects view or filter when useful.

No duplicate generic Effect row appears next to a native Workspace/Memory/Task row.

### Recovery updates

Rollback appears as a new run/timeline segment. Original cards remain unchanged except
for their folded current recovery badge. The UI shows per-unit progress and partial
results, and can resume observing a Runtime-backed rollback after reconnect.

## Edge cases and required behavior

| Case | Required behavior |
| --- | --- |
| Capture/resource projection fails | Do not execute or register an active unit; record preparation failure. |
| Effect throws | Known failure is `failed`; possible external commit is `unknown` and requires reconciliation. |
| Recovery throws | Record failed recovery, continue safe siblings, retry only that unit with stable idempotency. |
| Effect starts during rollback | Reject with `EFFECT_SCOPE_TERMINAL`; settle in-flight work before planning. |
| Irreversible child | Ordinary rollback is partial; required-recovery boundary blocks it; best-effort records it. |
| Expired state | Return `expired` before handler invocation; retain audit metadata. |
| Newer mutation | Native provider reports conflict; force needs explicit option/authority. |
| Duplicate request | Join existing Runtime work or return the recorded result; never compensate twice. |
| Restart/missing code | Reload records and exact id+version target; otherwise `handler_unavailable`. |
| Child then outer rollback | Skip recovered child units; an earlier valid outer snapshot may still restore. |
| Parallel same resource | Provider key serializes recovery; version checks guard the plan. |
| Unsupported native store | Keep evidence; required-recovery boundary blocks before mutation; ordinary scope says unavailable. |
| Blob/version GC | Live refs pin dependencies until recovery expiry/deletion. |
| Definition changes | Exact version required; old receipts are migrated, expired, or unavailable. |

## Errors and diagnostics

Public errors should follow existing Crux structured diagnostics with what failed, why,
what still works, and the next action. Candidate stable codes:

- `EFFECT_DUPLICATE_ID`
- `EFFECT_RESOURCE_FAILED`
- `EFFECT_CAPTURE_FAILED`
- `EFFECT_RECOVERY_REQUIRED`
- `EFFECT_RECOVERY_NOT_DURABLE`
- `EFFECT_RECOVERY_HANDLER_UNAVAILABLE`
- `EFFECT_RECOVERY_SHARED_UNIT`
- `EFFECT_RECOVERY_CONFLICT`
- `EFFECT_OUTCOME_AMBIGUOUS`
- `EFFECT_SCOPE_NOT_FOUND`
- `EFFECT_SCOPE_TERMINAL`
- `EFFECT_ROLLBACK_PARTIAL`
- `EFFECT_NATIVE_RECOVERY_UNSUPPORTED`

`EFFECT_RECOVERY_REQUIRED` must name the blocked effect and boundary, explain that no
recovery is available, and show every valid next action: define recovery, move the
effect outside the boundary, or choose `{ recovery: 'best-effort' }`. The strict
default is usable only when its first failure teaches the escape hatch.

Project Index/lint findings should distinguish authored risk from runtime failure:

- recoverable effect not exported/addressable for durable Runtime usage;
- obvious write-capable custom tool not backed by a native or custom effect;
- conflicting duplicate effect id/version pairs;
- recovery callback that appears to invoke nested recoveries directly;
- required-recovery boundary statically containing an explicitly
  irreversible effect;
- Workspace recovery disabled in a flow that exposes later rollback.

Static findings must remain evidence-based and avoid guessing from arbitrary function
names alone.

## Implementation boundaries

Keep deep modules for effect definitions, receipts, causal scopes, rollback planning,
recovery execution, native providers, Runtime ports, observability projection,
Devtools read models, and Project Index discovery/lint. Rollback planning must remain
separate from provider-specific recovery execution, and receipt persistence separate
from telemetry projection.

`@use-crux/core` remains provider-agnostic. Native providers depend only on core
domain/storage contracts. Host adapters bind durable/runtime behavior. No provider SDK
enters core.

## Test strategy

Contract suites cover:

- **Types/core:** overload/capture inference, no-input and extracted options, callable
  composition, conditional `.recover`, preparation, boundary modes, ordering, retries,
  terminal scopes, repeated/partial rollback, pre-result error precedence,
  discriminated refs, conflicts, expiry, and ambiguity.
- **Workspace:** shared/disjoint snapshots, mutation/blob fidelity, segmentation,
  nesting, unsupported mounts, transactions, linked restore, retention, and conflicts.
- **Runtime:** every adapter and lifecycle restart point, targets, leases, duplicates,
  retry/retention, missing handlers, suspend/resume, and both crash windows.
- **Composition/UI/index:** nested/parallel order, graph/privacy fixtures, native cards,
  preview/resumed progress, Project Index parity, and cache-identity updates.

## Rollout

Implementation lands as compatible vertical slices:

1. **Core/in-process:** definitions, receipts, scopes, `rollbackOnError`, ordering, and
   observability.
2. **Workspace:** #131 snapshots, lazy capture, coalescing, conflicts, and Devtools.
3. **Flow/Runtime:** persisted refs/envelopes, suspension, targets, leases, retries,
   retention, and delayed rollback.
4. **Compositions:** automatic boundaries and `result.effects` across adapters.
5. **Native providers:** memory, plan/task, blackboard, handoff, then audit-only domains.
6. **Policy/UI:** approvals, privileged preview/force, and optional agent tools.

No slice publishes a competing API. Durable capabilities may remain experimental
until Runtime conformance completes, while preserving the V1 `effect()` shape.

## Acceptance criteria

The RFC is complete when the implementation track can demonstrate:

1. One callable `effect()` works directly and unchanged in tools, flows, and pipelines;
   input/output and captured-pre-state recovery both work in-process.
2. `rollbackOnError()` reverses recoverable effects causally, blocks irreversible ones
   with an actionable diagnostic by default, and cannot silently return after an
   incomplete required manual rollback; a reviewer can trigger `flow.rollback()`.
3. A completed or suspended Runtime-backed run can be rejected later and recovered
   from its JSON-safe scope ref after restart, without a user registry.
4. Workspace calls covered by one anchor share a snapshot; intervening uncovered units
   split segments; exact-tree recovery preserves causal order and detects newer-state
   conflicts.
5. Discriminated refs reject the wrong API input before lookup; nested scopes, shared
   units, retries, duplicates, partial failures, crash ambiguity, and parallel branches
   have the specified typed outcomes and ordering.
6. Native cards stay native, custom effects are generic, and receipts correlate causal,
   approval, and source identity without exposing sensitive recovery state.
7. Project Index, observability, Devtools, docs, Workspace, and Runtime/adapter
   conformance suites ship with the capability.

## Dependencies

- #131 for Workspace namespace/subtree snapshots and restore.
- Workspace version history/retention and blob ownership.
- Existing Workspace transaction semantics.
- Canonical observability graph/schema and context propagation.
- Runtime targets, stores, leases, outbox/wake delivery, and retention.
- Existing tool approval lifecycle and Devtools command authorization boundaries.
- Project Index definition discovery and backend parity.

## Industry grounding

Grounding: Sagas, idempotency, immutable history, OTel causality, copy-on-write, and
optimistic concurrency. References:
[Temporal Saga patterns](https://go.temporal.io/platform-hub/patterns),
[AWS event sourcing](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/event-sourcing.html),
and [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/).

## Final boundary

#131 remains a focused Workspace storage RFC: capture and restore an exact namespace
or subtree safely. This RFC owns the cross-Crux effect model, receipts, scope
aggregation, rollback planning, Runtime durability, native-provider integration,
policy boundary, and Devtools/observability representation. Workspace snapshots are
one native recovery mechanism consumed by this broader model, not the location where
the broader model is implemented.
