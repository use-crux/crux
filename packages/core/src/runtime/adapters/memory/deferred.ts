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
    async putScope(scope) {
      recordWrite?.()
      data.deferredScopes.set(
        scopedKey(scope.namespace, scope.scopeId),
        cloneScope(scope),
      )
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
    async putIntent(intent) {
      recordWrite?.()
      data.deferredIntents.set(
        scopedKey(intent.namespace, intent.intentId),
        cloneIntent(intent),
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
    createdAt: new Date(intent.createdAt),
    updatedAt: new Date(intent.updatedAt),
  })
}
