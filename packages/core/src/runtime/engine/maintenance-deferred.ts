/** Lease-expiry reconciliation for unfinalized deferred invocations. */

import { isLeaseLostError } from './kernel-leases'
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
      // Single composite: prove observed fence/expiry, install maintenance
      // fence only as part of terminal abandonment, abandon siblings. No
      // crash window leaves an open scope under the maintenance token.
      //
      // This can run after process death, so it has no in-process scheduled
      // span to close. Durable intent state is authoritative; any maintenance
      // telemetry is deliberately best-effort rather than a collector protocol.
      const result = await deps.runComposite('defer.expire', {
        namespace: scope.namespace,
        scopeId: scope.scopeId,
        observedLeaseToken: scope.leaseToken,
        maintenanceLeaseToken: lease.token,
        reason: 'Deferred invocation lease expired before finalization.',
      })
      if (result.applied) abandoned += 1
    } catch (error) {
      // One racy/stale scope must not abort the rest of the maintenance batch.
      if (isLeaseLostError(error)) continue
      throw error
    } finally {
      await deps.store.leases.release(lease)
    }
  }
  return abandoned
}
