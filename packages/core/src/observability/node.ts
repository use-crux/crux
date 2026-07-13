/**
 * Node observability adapter.
 *
 * Optional subpath: keeps Node/Lambda-runtime handler conventions out of the
 * default edge-safe `@use-crux/core/observability` graph. Adapts a Node
 * Lambda-style `(event, context)` handler to {@link withObservableInvocation},
 * reading the Node Lambda runtime's `context.getRemainingTimeInMillis()` when
 * present instead of requiring callers to derive it by hand.
 *
 * @module
 */

import { withObservableInvocation, type CruxServerlessInvocation } from './handler'

/** Additional invocation knobs, minus the deadline this adapter derives from `context`. */
export type CruxNodeInvocationOptions = Omit<CruxServerlessInvocation, 'deadlineMs' | 'remainingTimeMs'>

/** Duck-typed shape of the Node Lambda runtime's invocation context. */
export interface CruxNodeLambdaContext {
  getRemainingTimeInMillis?: () => number
}

/**
 * Wrap a Node Lambda-style handler so each invocation binds its own scoped
 * host lifecycle, deriving the deadline from `context.getRemainingTimeInMillis()`
 * when the runtime provides it, and performs a bounded final flush before
 * returning or rethrowing.
 */
export function withNodeObservableInvocation<TEvent, TContext extends CruxNodeLambdaContext, TResult>(
  handler: (event: TEvent, context: TContext) => Promise<TResult>,
  options: CruxNodeInvocationOptions = {},
): (event: TEvent, context: TContext) => Promise<TResult> {
  return withObservableInvocation(handler, (_event, context) => {
    const remainingTimeMs = context?.getRemainingTimeInMillis?.()
    return {
      ...options,
      ...(remainingTimeMs !== undefined ? { remainingTimeMs } : {}),
    }
  })
}
