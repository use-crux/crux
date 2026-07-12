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
} from '../ports/ids'
import type { RuntimeStoreTransaction } from '../store'
import { createRuntimeError } from './errors'
import { taskRunKey } from './idempotency'
import { wakeEnvelopeForWork } from './kernel-shared'
import type { RuntimeCompositeDeps } from './composites'
import { cloneRuntimeJsonValue } from './json-value'

/** Input that durably accepts one named target without making it runnable. */
export interface StageDeferredIntentInput {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  readonly intentId: DeferredIntentId
  readonly leaseToken: LeaseToken
  readonly leaseExpiresAt: Date
  readonly targetId: RuntimeTargetId
  readonly input: JsonValue
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

/** Observable result of a terminal scope compare-and-set. */
export interface DeferredScopeTransitionResult {
  readonly applied: boolean
  readonly terminal: 'finalized' | 'abandoned'
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
    if (
      existingIntent.scopeId !== input.scopeId ||
      existingIntent.targetId !== input.targetId
    ) {
      throw deferredConflict(input.scopeId)
    }
    return existingIntent
  }

  const acceptedInput = cloneRuntimeJsonValue(
    input.input,
    'deferred intent input',
  )
  const scope = await ensureOpenScope(tx, deps, input)
  assertScopeLease(scope, input.leaseToken)
  const now = deps.now()
  const intent: RuntimeDeferredIntent = Object.freeze({
    namespace: input.namespace,
    scopeId: input.scopeId,
    intentId: input.intentId,
    workId: deps.newWorkId(),
    targetId: input.targetId,
    input: acceptedInput,
    state: 'staged',
    createdAt: now,
    updatedAt: now,
  })
  await tx.deferred.putIntent(intent)
  return intent
}

/** Finalize and release a deferred invocation inside one transaction. */
export async function finalizeDeferredScopeInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: FinalizeDeferredScopeInput,
): Promise<DeferredScopeTransitionResult> {
  const scope = await requiredScope(tx, input.namespace, input.scopeId)
  if (scope.finalization.state !== 'open') {
    return { applied: false, terminal: scope.finalization.state }
  }
  assertScopeLease(scope, input.leaseToken)

  const now = deps.now()
  const intents = await tx.deferred.listIntents({
    namespace: input.namespace,
    scopeId: input.scopeId,
  })
  for (const intent of intents) {
    if (intent.state !== 'staged') continue
    const work = await tx.state.createWork({
      workId: intent.workId,
      namespace: intent.namespace,
      work: {
        kind: 'task.run',
        taskId: intent.workId as unknown as TaskId,
        targetId: intent.targetId,
        input: intent.input,
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
  }
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
  if (scope.finalization.state !== 'open') {
    return { applied: false, terminal: scope.finalization.state }
  }
  assertScopeLease(scope, input.leaseToken)

  const now = deps.now()
  const intents = await tx.deferred.listIntents({
    namespace: input.namespace,
    scopeId: input.scopeId,
  })
  for (const intent of intents) {
    if (intent.state !== 'staged') continue
    await tx.deferred.putIntent({
      ...intent,
      state: 'abandoned',
      updatedAt: now,
    })
  }
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
  await tx.deferred.putScope(scope)
  return scope
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

function deferredConflict(scopeId: DeferredScopeId): Error {
  return new Error(
    `Deferred invocation \`${scopeId}\` is missing or already terminal.`,
  )
}
