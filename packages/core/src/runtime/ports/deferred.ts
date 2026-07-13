/**
 * Durable deferred-intent records used by the Runtime Engine.
 *
 * Adapters persist these records; the kernel alone owns their legal
 * transitions and the transaction that releases or abandons sibling intents.
 *
 * @module
 */

import type { JsonValue } from '../../storage'
import type {
  DeferredIntentId,
  DeferredScopeId,
  LeaseToken,
  RuntimeTargetId,
  WorkId,
} from './ids'
import type { RuntimeStateReadOptions } from './state'

/** Logical result committed for a deferred invocation. */
export type RuntimeDeferInvocationOutcome =
  | 'success'
  | 'error'
  | 'redirect'
  | 'not-found'
  | 'cancelled'

/** Terminal state of a durable deferred invocation. */
export type RuntimeDeferFinalization =
  | { readonly state: 'open' }
  | {
      readonly state: 'finalized'
      readonly outcome: RuntimeDeferInvocationOutcome
      readonly finalizedAt: Date
    }
  | {
      readonly state: 'abandoned'
      readonly abandonedAt: Date
      readonly reason: string
    }

/** Durable record fencing all named work staged by one invocation. */
export interface RuntimeDeferredScope {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  readonly leaseToken: LeaseToken
  readonly leaseExpiresAt: Date
  readonly finalization: RuntimeDeferFinalization
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** Durable lifecycle of one named deferred target registration. */
export type RuntimeDeferredIntentState = 'staged' | 'released' | 'abandoned'

/** Named work accepted durably before its invocation is finalized. */
export interface RuntimeDeferredIntent {
  readonly namespace: string
  readonly scopeId: DeferredScopeId
  readonly intentId: DeferredIntentId
  readonly workId: WorkId
  readonly targetId: RuntimeTargetId
  readonly input: JsonValue
  /**
   * Optional JSON-safe observability provenance carried into released
   * `task.run` work so execution can emit `defer.run` evidence.
   */
  readonly provenance?: JsonValue
  readonly state: RuntimeDeferredIntentState
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** Bounded query for intents owned by one invocation. */
export interface ListRuntimeDeferredIntentsOptions extends RuntimeStateReadOptions {
  readonly scopeId: DeferredScopeId
  readonly state?: RuntimeDeferredIntentState
  readonly limit?: number
}

/** Bounded query used by maintenance to find expired open invocations. */
export interface ListRuntimeDeferredScopesOptions extends RuntimeStateReadOptions {
  readonly state?: RuntimeDeferFinalization['state']
  readonly leaseExpiresBefore?: Date
  readonly limit?: number
}

/** Adapter storage operations for durable deferred scopes and intents. */
export interface RuntimeDeferredStorePort {
  getScope(
    scopeId: DeferredScopeId,
    options: RuntimeStateReadOptions,
  ): Promise<RuntimeDeferredScope | null>
  /**
   * Insert a scope only when absent.
   *
   * Concurrent first-stage races and delayed creators must not overwrite an
   * existing row's lease token, expiry, or finalization. Returns the durable
   * row after the attempt (newly created or the pre-existing record).
   */
  createScope(scope: RuntimeDeferredScope): Promise<RuntimeDeferredScope>
  /**
   * Replace fields on an existing scope row under a locked transaction.
   *
   * Kernel callers must already hold the row (via {@link getScope}) and prove
   * open/fencing state before writing renew/finalize/abandon updates.
   *
   * Lifecycle is monotonic (analogous to {@link putIntent}):
   * - missing rows are a no-op
   * - open may renew (open→open) or move to a terminal state
   * - finalized/abandoned must never reopen to open
   * - finalized and abandoned must not switch to the other terminal state
   * Illegal transitions are no-ops so the kernel CAS can detect conflict.
   */
  putScope(scope: RuntimeDeferredScope): Promise<void>
  listScopes(
    options: ListRuntimeDeferredScopesOptions,
  ): Promise<readonly RuntimeDeferredScope[]>
  getIntent(
    intentId: DeferredIntentId,
    options: RuntimeStateReadOptions,
  ): Promise<RuntimeDeferredIntent | null>
  /**
   * Insert an intent only when absent.
   *
   * Concurrent staging races must preserve the first accepted workId, target,
   * and input. Returns the durable row after the attempt (newly created or the
   * pre-existing record).
   */
  createIntent(intent: RuntimeDeferredIntent): Promise<RuntimeDeferredIntent>
  /**
   * Update an existing intent's lifecycle fields under a locked transaction.
   *
   * Kernel callers use this for staged → released/abandoned transitions only.
   * Identity columns (workId, targetId, input, scopeId) must not change. A
   * terminal row may only receive an idempotent write of the same terminal
   * state; released and abandoned must never switch. Missing rows are a no-op.
   */
  putIntent(intent: RuntimeDeferredIntent): Promise<void>
  listIntents(
    options: ListRuntimeDeferredIntentsOptions,
  ): Promise<readonly RuntimeDeferredIntent[]>
}
