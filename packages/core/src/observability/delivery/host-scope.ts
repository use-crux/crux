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

import { createAsyncScopeFacet } from '../../async-scope'
import { asyncScopeStorageAvailable } from '../../async-scope/internal/carrier'
import type { CruxHostLifecycle } from '../../runtime/api/host-lifecycle'

const hostLifecycleScope = createAsyncScopeFacet<CruxHostLifecycle>(
  'core.observability-host-lifecycle',
)

/** Run `fn` with a host lifecycle scoped to its call tree. */
export function runWithHostLifecycle<R>(lifecycle: CruxHostLifecycle, fn: () => R): R {
  const supportsAsyncPropagation = asyncScopeStorageAvailable()
  return hostLifecycleScope.run(lifecycle, () => {
    const result = fn()
    if (!supportsAsyncPropagation && isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => undefined)
      return Promise.reject(fallbackAsyncHostLifecycleError()) as R
    }
    return result
  })
}

/** The innermost host lifecycle bound by {@link runWithHostLifecycle}, if any. */
export function activeHostLifecycle(): CruxHostLifecycle | undefined {
  return hostLifecycleScope.current()
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function fallbackAsyncHostLifecycleError(): Error {
  return new Error(
    'observe.withHostLifecycle requires AsyncLocalStorage for async execution. The fallback host lifecycle scope is synchronous-only.',
  )
}
