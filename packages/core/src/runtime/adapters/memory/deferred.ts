import type {
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
  RuntimeDeferredStorePort,
} from '../../ports/deferred'
import type { MemoryRuntimeData, MemoryWriteRecorder } from './data'
import { scopedKey } from './data'
import { cloneJsonValue } from './json'

export function createMemoryDeferredStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeDeferredStorePort {
  return {
    async getScope(scopeId, options) {
      const scope = data.deferredScopes.get(
        scopedKey(options.namespace, scopeId),
      )
      return scope ? cloneScope(scope) : null
    },
    async createScope(scope) {
      recordWrite?.()
      const key = scopedKey(scope.namespace, scope.scopeId)
      const existing = data.deferredScopes.get(key)
      if (existing) return cloneScope(existing)
      const created = cloneScope(scope)
      data.deferredScopes.set(key, created)
      return cloneScope(created)
    },
    async putScope(scope) {
      recordWrite?.()
      const key = scopedKey(scope.namespace, scope.scopeId)
      // Updates only — creation must use createScope so terminal/fencing state
      // cannot be reopened by a delayed initial-row write.
      const existing = data.deferredScopes.get(key)
      if (!existing) return
      if (!isScopeLifecycleAllowed(existing.finalization, scope.finalization)) {
        return
      }
      data.deferredScopes.set(key, cloneScope(scope))
    },
    async listScopes(options) {
      return [...data.deferredScopes.values()]
        .filter(
          (scope) =>
            scope.namespace === options.namespace &&
            (options.state === undefined ||
              scope.finalization.state === options.state) &&
            (options.leaseExpiresBefore === undefined ||
              scope.leaseExpiresAt.getTime() <
                options.leaseExpiresBefore.getTime()),
        )
        .slice(0, options.limit)
        .map(cloneScope)
    },
    async getIntent(intentId, options) {
      const intent = data.deferredIntents.get(
        scopedKey(options.namespace, intentId),
      )
      return intent ? cloneIntent(intent) : null
    },
    async createIntent(intent) {
      recordWrite?.()
      const key = scopedKey(intent.namespace, intent.intentId)
      const existing = data.deferredIntents.get(key)
      if (existing) return cloneIntent(existing)
      const created = cloneIntent(intent)
      data.deferredIntents.set(key, created)
      return cloneIntent(created)
    },
    async putIntent(intent) {
      recordWrite?.()
      const key = scopedKey(intent.namespace, intent.intentId)
      const existing = data.deferredIntents.get(key)
      // Updates only — creation must use createIntent so concurrent staging
      // cannot overwrite the first accepted work identity.
      if (!existing) return
      // A staged intent may choose one terminal state. Terminal writes are
      // idempotent only when they repeat that same state.
      if (existing.state !== 'staged' && intent.state !== existing.state) return
      data.deferredIntents.set(
        key,
        cloneIntent({
          ...existing,
          state: intent.state,
          // Preserve identity + provenance; lifecycle fields only.
          updatedAt: intent.updatedAt,
        }),
      )
    },
    async listIntents(options) {
      return [...data.deferredIntents.values()]
        .filter(
          (intent) =>
            intent.namespace === options.namespace &&
            intent.scopeId === options.scopeId &&
            (options.state === undefined || intent.state === options.state),
        )
        .slice(0, options.limit)
        .map(cloneIntent)
    },
  }
}

/**
 * Scope finalization is monotonic: open may renew or close; terminal states
 * never reopen or flip to the opposite terminal.
 */
function isScopeLifecycleAllowed(
  from: RuntimeDeferredScope['finalization'],
  to: RuntimeDeferredScope['finalization'],
): boolean {
  if (from.state === 'open') return true
  if (to.state === 'open') return false
  return from.state === to.state
}

function cloneScope(scope: RuntimeDeferredScope): RuntimeDeferredScope {
  return Object.freeze({
    ...scope,
    leaseExpiresAt: new Date(scope.leaseExpiresAt),
    finalization:
      scope.finalization.state === 'open'
        ? scope.finalization
        : scope.finalization.state === 'finalized'
          ? {
              ...scope.finalization,
              finalizedAt: new Date(scope.finalization.finalizedAt),
            }
          : {
              ...scope.finalization,
              abandonedAt: new Date(scope.finalization.abandonedAt),
            },
    createdAt: new Date(scope.createdAt),
    updatedAt: new Date(scope.updatedAt),
  })
}

function cloneIntent(intent: RuntimeDeferredIntent): RuntimeDeferredIntent {
  return Object.freeze({
    ...intent,
    input: cloneJsonValue(intent.input, 'deferred intent input'),
    ...(intent.provenance === undefined
      ? {}
      : {
          provenance: cloneJsonValue(
            intent.provenance,
            'deferred intent provenance',
          ),
        }),
    createdAt: new Date(intent.createdAt),
    updatedAt: new Date(intent.updatedAt),
  })
}
