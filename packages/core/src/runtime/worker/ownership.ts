/** Process-local Runtime worker ownership by store identity and namespace. */

import type {
  RuntimeMaintenanceOwnershipLease,
} from '../ports/maintenance-ownership'
import type { RuntimeStoreAdapter } from '../store'
import { createRuntimeError } from '../engine/errors'

const activeOwners = new WeakMap<RuntimeStoreAdapter, Map<string, symbol>>()

/** Acquire exclusive process-local maintenance ownership. */
export function acquireRuntimeWorkerOwnership(
  store: RuntimeStoreAdapter,
  namespace: string,
): () => void {
  const owners = activeOwners.get(store) ?? new Map<string, symbol>()
  if (owners.has(namespace)) throw duplicateOwnerError(namespace)

  const owner = Symbol(namespace)
  owners.set(namespace, owner)
  activeOwners.set(store, owners)
  let released = false
  return () => {
    if (released) return
    released = true
    if (owners.get(namespace) !== owner) return
    owners.delete(namespace)
    if (owners.size === 0) activeOwners.delete(store)
  }
}

/** Acquire optional store-backed maintenance ownership. */
export async function acquireDurableRuntimeWorkerOwnership(
  store: RuntimeStoreAdapter,
  namespace: string,
): Promise<RuntimeMaintenanceOwnershipLease | undefined> {
  const result = await store.maintenanceOwnership?.acquire(namespace)
  if (!result) return undefined
  if (!result.acquired) throw duplicateDurableOwnerError(namespace)
  return result
}

function duplicateOwnerError(
  namespace: string,
): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'OWNERSHIP_CONFLICT',
    whatFailed: `Runtime worker maintenance ownership is already active for namespace \`${namespace}\` on this store.`,
    why: 'Exactly one worker may maintain a store and namespace within the current process.',
    whatStillWorks:
      'Workers using another store or namespace, and the existing owner, continue to run.',
    nextStep:
      'Reuse the active worker or await worker.stop() before creating its replacement.',
  })
}

function duplicateDurableOwnerError(
  namespace: string,
): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'OWNERSHIP_CONFLICT',
    whatFailed: `Runtime worker maintenance ownership is already held for namespace \`${namespace}\` in the durable store.`,
    why: 'Exactly one worker may maintain a durable store and namespace across processes.',
    whatStillWorks:
      'The existing maintenance owner and workers using another namespace continue to run.',
    nextStep:
      'Stop the existing worker or wait for it to release ownership before starting a replacement.',
  })
}
