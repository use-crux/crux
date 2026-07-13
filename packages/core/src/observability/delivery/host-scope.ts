/**
 * Request-scoped host lifecycle binding for the delivery engine.
 *
 * `setObservabilityTransport(transport, { hostLifecycle })` binds one host
 * lifecycle for the whole process, which is correct for a single long-lived
 * host but races when concurrent physical invocations (e.g. concurrent
 * serverless invocations sharing a warm module) each need their own
 * defer/deadline. `runWithHostLifecycle` scopes a lifecycle to one call tree
 * using the same portable async-context storage as the runtime host context,
 * so concurrent invocations never see each other's lifecycle.
 *
 * @module
 */

import { createContextStorageResolver, runWithSynchronousContext } from '../../shared/context-storage'
import type { CruxHostLifecycle } from '../../runtime/api/host-lifecycle'

const contextStorage = createContextStorageResolver<CruxHostLifecycle>()
const fallbackStack: CruxHostLifecycle[] = []

/** Run `fn` with a host lifecycle scoped to its call tree. */
export function runWithHostLifecycle<R>(lifecycle: CruxHostLifecycle, fn: () => R): R {
  const activeStorage = contextStorage.getStorage()
  if (activeStorage) return activeStorage.run(lifecycle, fn)
  return runWithSynchronousContext(fallbackStack, lifecycle, fn, fallbackAsyncHostLifecycleError)
}

/** The innermost host lifecycle bound by {@link runWithHostLifecycle}, if any. */
export function activeHostLifecycle(): CruxHostLifecycle | undefined {
  const activeStorage = contextStorage.getStorage()
  if (activeStorage) return activeStorage.get()
  return fallbackStack[fallbackStack.length - 1]
}

function fallbackAsyncHostLifecycleError(): Error {
  return new Error(
    'observe.withHostLifecycle requires AsyncLocalStorage for async execution. The fallback host lifecycle scope is synchronous-only.',
  )
}
