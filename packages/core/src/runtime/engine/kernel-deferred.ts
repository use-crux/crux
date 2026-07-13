/** Atomic staging and terminal transitions for durable deferred work. @module */

import type { JsonValue } from '../../storage'
import type {
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
  RuntimeDeferInvocationOutcome,
} from '../ports/deferred'
import type {
  DeferredIntentId,
  DeferredScopeId,
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  WorkId,
} from '../ports/ids'
import type { RuntimeStoreTransaction } from '../store'
import { createRuntimeError } from './errors'
import { taskRunKey } from './idempotency'
import { wakeEnvelopeForWork } from './kernel-shared'
import type { RuntimeCompositeDeps } from './composites'
import { cloneRuntimeJsonValue } from './json-value'

/** Page size for sibling scans inside one terminal composite transaction. */
const DEFERRED_SIBLING_BATCH = 256

/**
 * Safety tripwire for sibling scans that keep reporting progress but never
 * empty (adapter bugs / runaway staging). With {@link DEFERRED_SIBLING_BATCH}
 * this caps ~262k staged intents — far above declared host callback bounds and
 * Postgres/Convex default page sizes — without relying only on identical-page
 * detection (which misses rotating fake pages).
 */
const DEFERRED_SIBLING_MAX_PAGES = 1024

/** Input that durably accepts one named target without making it runnable. */
export interface StageDeferredIntentInput {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  readonly intentId: DeferredIntentId
  readonly leaseToken: LeaseToken
  readonly leaseExpiresAt: Date
  readonly targetId: RuntimeTargetId
  readonly input: JsonValue
  /** Optional JSON-safe observability provenance for later `defer.run` emission. */
  readonly provenance?: JsonValue
}

/** Input that atomically releases every staged sibling. */
export interface FinalizeDeferredScopeInput {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  readonly leaseToken: LeaseToken
  readonly outcome: RuntimeDeferInvocationOutcome
}

/** Input that atomically abandons an unfinalized invocation and its siblings. */
export interface AbandonDeferredScopeInput {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  readonly leaseToken: LeaseToken
  readonly reason: string
}

/** Input that renews an open deferred scope lease for a live owner. */
export interface RenewDeferredScopeLeaseInput {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  /** Token that must currently fence the open scope. */
  readonly leaseToken: LeaseToken
  /** Expiry written to the durable scope record. */
  readonly leaseExpiresAt: Date
}

/**
 * Input that atomically takes over an expired open scope and abandons it.
 *
 * Lease-store claim remains external proof of takeover eligibility. This
 * composite must never leave an open scope fenced by the maintenance token:
 * observed old fence/expiry eligibility, terminal abandonment, and staged
 * sibling abandonment happen in one transaction.
 */
export interface ExpireDeferredScopeInput {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  /** Fence token observed when listing the expired open scope. */
  readonly observedLeaseToken: LeaseToken
  /** Maintenance claim token recorded with the terminal abandonment. */
  readonly maintenanceLeaseToken: LeaseToken
  readonly reason: string
}

/** Observable result of a terminal scope compare-and-set. */
export interface DeferredScopeTransitionResult {
  readonly applied: boolean
  readonly terminal: 'finalized' | 'abandoned'
}

/**
 * Result of atomic expire-and-abandon.
 *
 * `applied: true` means the scope is now abandoned under the maintenance fence.
 * `applied: false` never claims a terminal state the composite did not write:
 * it reports the observed durable state (`missing` / `open` / terminal) so
 * maintenance can skip without lying that the scope is abandoned.
 */
export type ExpireDeferredScopeResult =
  | { readonly applied: true; readonly terminal: 'abandoned' }
  | {
      readonly applied: false
      readonly observed: 'missing' | 'open' | 'finalized' | 'abandoned'
    }

/** Result of a scope lease renew attempt. */
export interface RenewDeferredScopeLeaseResult {
  readonly renewed: boolean
  readonly scope: RuntimeDeferredScope | null
}

/** Accept one staged target idempotently inside a transaction. */
export async function stageDeferredIntentInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: StageDeferredIntentInput,
): Promise<RuntimeDeferredIntent> {
  const existingIntent = await tx.deferred.getIntent(input.intentId, {
    namespace: input.namespace,
  })
  if (existingIntent) {
    // Idempotent success only for still-staged rows with matching identity.
    // Released/abandoned must conflict so callers never treat a terminal intent
    // as a fresh stage before ensureOpenScope.
    assertStagedIntentIdentity(existingIntent, input)
    return existingIntent
  }

  const acceptedInput = cloneRuntimeJsonValue(
    input.input,
    'deferred intent input',
  )
  const acceptedProvenance =
    input.provenance === undefined
      ? undefined
      : cloneRuntimeJsonValue(input.provenance, 'deferred intent provenance')
  const scope = await ensureOpenScope(tx, deps, input)
  assertScopeLease(scope, input.leaseToken)
  const now = deps.now()
  const workId = deps.newWorkId()
  const intent: RuntimeDeferredIntent = Object.freeze({
    namespace: input.namespace,
    scopeId: input.scopeId,
    intentId: input.intentId,
    workId,
    targetId: input.targetId,
    input: acceptedInput,
    ...(acceptedProvenance !== undefined
      ? {
          provenance: mergeProvenanceWorkId(acceptedProvenance, workId),
        }
      : {}),
    state: 'staged',
    createdAt: now,
    updatedAt: now,
  })
  // Insert-if-absent: concurrent staging converges on the first work identity.
  const stored = await tx.deferred.createIntent(intent)
  assertStagedIntentIdentity(stored, input)
  return stored
}

/** Finalize and release a deferred invocation inside one transaction. */
export async function finalizeDeferredScopeInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: FinalizeDeferredScopeInput,
): Promise<DeferredScopeTransitionResult> {
  const scope = await requiredScope(tx, input.namespace, input.scopeId)
  assertScopeLease(scope, input.leaseToken)
  if (scope.finalization.state !== 'open') {
    return { applied: false, terminal: scope.finalization.state }
  }

  const now = deps.now()
  await forEachStagedIntent(
    tx,
    input.namespace,
    input.scopeId,
    async (intent) => {
      const work = await tx.state.createWork({
        workId: intent.workId,
        namespace: intent.namespace,
        work: {
          kind: 'task.run',
          taskId: intent.workId as unknown as TaskId,
          targetId: intent.targetId,
          input: intent.input,
          ...(intent.provenance !== undefined
            ? { defer: intent.provenance }
            : {}),
        },
        targetId: intent.targetId,
        idempotencyKey: taskRunKey(intent.workId),
        now,
      })
      await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: now })
      await tx.deferred.putIntent({
        ...intent,
        state: 'released',
        updatedAt: now,
      })
    },
  )
  await tx.deferred.putScope({
    ...scope,
    finalization: {
      state: 'finalized',
      outcome: input.outcome,
      finalizedAt: now,
    },
    updatedAt: now,
  })
  return { applied: true, terminal: 'finalized' }
}

/** Abandon an unfinalized invocation inside one transaction. */
export async function abandonDeferredScopeInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: AbandonDeferredScopeInput,
): Promise<DeferredScopeTransitionResult> {
  const scope = await requiredScope(tx, input.namespace, input.scopeId)
  assertScopeLease(scope, input.leaseToken)
  if (scope.finalization.state !== 'open') {
    return { applied: false, terminal: scope.finalization.state }
  }

  const now = deps.now()
  await forEachStagedIntent(
    tx,
    input.namespace,
    input.scopeId,
    async (intent) => {
      await tx.deferred.putIntent({
        ...intent,
        state: 'abandoned',
        updatedAt: now,
      })
    },
  )
  await tx.deferred.putScope({
    ...scope,
    finalization: {
      state: 'abandoned',
      abandonedAt: now,
      reason: input.reason,
    },
    updatedAt: now,
  })
  return { applied: true, terminal: 'abandoned' }
}

/**
 * Renew an open deferred scope lease inside one transaction.
 *
 * Owner heartbeats call this after a successful lease-store extend. A missing
 * scope (pre-first-stage) returns `{ renewed: false, scope: null }` so the
 * session may still advance its active lease. Non-open scopes return without
 * throwing so the durable session can poison on mismatch with open fencing.
 * A token mismatch raises `LEASE_LOST`.
 */
export async function renewDeferredScopeLeaseInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: RenewDeferredScopeLeaseInput,
): Promise<RenewDeferredScopeLeaseResult> {
  const scope = await tx.deferred.getScope(input.scopeId, {
    namespace: input.namespace,
  })
  if (!scope) return { renewed: false, scope: null }
  if (scope.finalization.state !== 'open') {
    return { renewed: false, scope }
  }
  assertScopeLease(scope, input.leaseToken)

  const next: RuntimeDeferredScope = Object.freeze({
    ...scope,
    leaseExpiresAt: input.leaseExpiresAt,
    updatedAt: deps.now(),
  })
  await tx.deferred.putScope(next)
  return { renewed: true, scope: next }
}

/**
 * Atomically expire-and-abandon an open scope whose observed fence is still
 * eligible. Racy live/stale/mismatched scopes return `applied: false` with the
 * observed durable state (never a false `terminal: abandoned` claim) so
 * maintenance can continue across the batch.
 */
export async function expireDeferredScopeInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: ExpireDeferredScopeInput,
): Promise<ExpireDeferredScopeResult> {
  const scope = await tx.deferred.getScope(input.scopeId, {
    namespace: input.namespace,
  })
  if (!scope) return { applied: false, observed: 'missing' }
  if (scope.finalization.state !== 'open') {
    return { applied: false, observed: scope.finalization.state }
  }
  // Still open but not eligible for this maintenance claim — report open.
  if (scope.leaseToken !== input.observedLeaseToken) {
    return { applied: false, observed: 'open' }
  }
  if (scope.leaseExpiresAt.getTime() >= deps.now().getTime()) {
    return { applied: false, observed: 'open' }
  }

  const now = deps.now()
  await forEachStagedIntent(
    tx,
    input.namespace,
    input.scopeId,
    async (intent) => {
      await tx.deferred.putIntent({
        ...intent,
        state: 'abandoned',
        updatedAt: now,
      })
    },
  )
  // Install the maintenance fence only as part of the terminal write so a
  // process death after this composite never leaves an open scope under the
  // maintenance token.
  await tx.deferred.putScope({
    ...scope,
    leaseToken: input.maintenanceLeaseToken,
    finalization: {
      state: 'abandoned',
      abandonedAt: now,
      reason: input.reason,
    },
    updatedAt: now,
  })
  return { applied: true, terminal: 'abandoned' }
}

async function forEachStagedIntent(
  tx: RuntimeStoreTransaction,
  namespace: string,
  scopeId: DeferredScopeId,
  visit: (intent: RuntimeDeferredIntent) => Promise<void>,
): Promise<void> {
  // Adapters may hard-cap pages below the requested limit. A short nonempty
  // page is not exhaustion — only an empty staged page ends the scan.
  let previousBatchKey: string | undefined
  for (let page = 0; page < DEFERRED_SIBLING_MAX_PAGES; page += 1) {
    const batch = await tx.deferred.listIntents({
      namespace,
      scopeId,
      state: 'staged',
      limit: DEFERRED_SIBLING_BATCH,
    })
    if (batch.length === 0) return
    const batchKey = batch.map((intent) => intent.intentId).join('\0')
    if (batchKey === previousBatchKey) {
      throw new Error(
        `Deferred invocation \`${scopeId}\` made no progress transitioning staged intents; the store returned the same staged page twice.`,
      )
    }
    previousBatchKey = batchKey
    for (const intent of batch) {
      // Defensive: adapters must honor the staged filter; skip if they do not.
      if (intent.state !== 'staged') continue
      await visit(intent)
    }
  }
  throw new Error(
    `Deferred invocation \`${scopeId}\` exceeded ${DEFERRED_SIBLING_MAX_PAGES} staged-intent pages without emptying; the store may be returning rotating pages or staging is unbounded. Scope remains open.`,
  )
}

async function ensureOpenScope(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: StageDeferredIntentInput,
): Promise<RuntimeDeferredScope> {
  const existing = await tx.deferred.getScope(input.scopeId, {
    namespace: input.namespace,
  })
  if (existing) {
    if (existing.finalization.state !== 'open') {
      throw deferredConflict(input.scopeId)
    }
    return existing
  }
  const now = deps.now()
  const scope: RuntimeDeferredScope = Object.freeze({
    namespace: input.namespace,
    scopeId: input.scopeId,
    leaseToken: input.leaseToken,
    leaseExpiresAt: input.leaseExpiresAt,
    finalization: { state: 'open' as const },
    createdAt: now,
    updatedAt: now,
  })
  // Insert-if-absent: never overwrite lease/finalization from a concurrent or
  // delayed first-stage write under READ COMMITTED.
  const stored = await tx.deferred.createScope(scope)
  if (stored.finalization.state !== 'open') {
    throw deferredConflict(input.scopeId)
  }
  assertScopeLease(stored, input.leaseToken)
  return stored
}

async function requiredScope(
  tx: RuntimeStoreTransaction,
  namespace: string,
  scopeId: DeferredScopeId,
): Promise<RuntimeDeferredScope> {
  const scope = await tx.deferred.getScope(scopeId, { namespace })
  if (scope) return scope
  throw deferredConflict(scopeId)
}

function assertScopeLease(
  scope: RuntimeDeferredScope,
  leaseToken: LeaseToken,
): void {
  if (scope.leaseToken === leaseToken) return
  throw createRuntimeError({
    code: 'LEASE_LOST',
    whatFailed: `Deferred invocation \`${scope.scopeId}\` lost its lease before commit.`,
    why: 'Another owner fenced this invocation before its durable transition.',
    whatStillWorks:
      'The winning terminal transition remains durable and staged work cannot be resurrected.',
    nextStep:
      'No action is needed for an isolated race. Check host liveness and lease renewal if this repeats.',
  })
}

function assertStagedIntentIdentity(
  intent: RuntimeDeferredIntent,
  input: StageDeferredIntentInput,
): void {
  if (
    intent.scopeId !== input.scopeId ||
    intent.targetId !== input.targetId ||
    intent.state !== 'staged'
  ) {
    throw deferredConflict(input.scopeId)
  }
}

function deferredConflict(scopeId: DeferredScopeId): Error {
  return new Error(
    `Deferred invocation \`${scopeId}\` is missing or already terminal.`,
  )
}

function mergeProvenanceWorkId(
  provenance: JsonValue,
  workId: WorkId,
): JsonValue {
  if (
    !provenance ||
    typeof provenance !== 'object' ||
    Array.isArray(provenance)
  ) {
    return provenance
  }
  return Object.freeze({
    ...(provenance as Record<string, JsonValue | undefined>),
    workId,
  }) as JsonValue
}
