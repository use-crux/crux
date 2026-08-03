/** Process-local Runtime worker ownership by store identity and namespace. */

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

function duplicateOwnerError(
  namespace: string,
): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'CAPABILITY_MISSING',
    whatFailed: `Runtime worker maintenance ownership is already active for namespace \`${namespace}\` on this store.`,
    why: 'Exactly one worker may maintain a store and namespace within the current process.',
    whatStillWorks:
      'Workers using another store or namespace, and the existing owner, continue to run.',
    nextStep:
      'Reuse the active worker or await worker.stop() before creating its replacement.',
  })
}
