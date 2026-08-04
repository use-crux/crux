import { createRuntimeError, type RuntimeStoreAdapter } from '@use-crux/core/runtime'
import { decodeCompositeValue, encodeCompositeValue } from './codec'
import { assertConvexDeferredComponent } from './deferred-store'
import type { ConvexRuntimeComponent } from './store-types'

/** Bind named composites to the component's one-mutation dispatcher. */
export function createConvexCompositeRunner(options: {
  readonly refs: ConvexRuntimeComponent['runtime']
  readonly run: <TResult>(ref: unknown, args: Record<string, unknown>) => Promise<TResult>
}): NonNullable<RuntimeStoreAdapter['runComposite']> {
  return async (kind, input) => {
    if (kind.startsWith('defer.')) assertConvexDeferredComponent(options.refs.deferred)
    const ref = options.refs.composites?.run
    if (!ref) {
      throw createRuntimeError({
        code: 'SETUP_REQUIRED',
        whatFailed: 'Convex Runtime Engine component is missing runtime.composites.run.',
        why: 'Runtime Engine composites must execute inside one Convex component mutation for host-bound atomicity.',
        whatStillWorks:
          'Non-runtime Convex storage and already deployed older runtime functions can still run until they hit a composite commit.',
        nextStep:
          'Regenerate or update the Crux Convex component so components.crux.runtime.composites.run is available.',
      })
    }
    return decodeCompositeValue(await options.run(ref, { kind, input: encodeCompositeValue(input) }))
  }
}
