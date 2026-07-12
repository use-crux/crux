/** Lease-expiry reconciliation for unfinalized deferred invocations. */

import type { RuntimeStoreAdapter } from '../store'
import type { RuntimeCompositeRunner } from './composites'

/** Abandon open scopes only after the adapter proves their lease expired. */
export async function abandonExpiredDeferredScopes(
  deps: {
    readonly store: RuntimeStoreAdapter
    readonly runComposite: RuntimeCompositeRunner
    readonly leaseTtlMs: number
  },
  options: {
    readonly namespace?: string
    readonly now: Date
    readonly limit?: number
  },
): Promise<number> {
  if (!options.namespace) return 0
  const scopes = await deps.store.deferred.listScopes({
    namespace: options.namespace,
    state: 'open',
    leaseExpiresBefore: options.now,
    limit: options.limit,
  })
  let abandoned = 0
  for (const scope of scopes) {
    const lease = await deps.store.leases.claim(`defer:${scope.scopeId}`, {
      ttlMs: deps.leaseTtlMs,
    })
    if (!lease) continue
    try {
      const result = await deps.runComposite('defer.abandon', {
        namespace: scope.namespace,
        scopeId: scope.scopeId,
        leaseToken: scope.leaseToken,
        reason: 'Deferred invocation lease expired before finalization.',
      })
      if (result.applied) abandoned += 1
    } finally {
      await deps.store.leases.release(lease)
    }
  }
  return abandoned
}
