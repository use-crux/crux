import { createRuntimeError } from '@use-crux/core/runtime'
import type { RuntimeDeferredStorePort } from '@use-crux/core/runtime'
import {
  decodeDeferredIntent,
  decodeDeferredScope,
  encodeDeferredIntent,
  encodeDeferredScope,
} from './codec'

type RunMutation = <TResult>(
  ref: unknown,
  args: Record<string, unknown>,
) => Promise<TResult>

/** Build the client-side Convex deferred record port from component refs. */
export function createConvexDeferredStore(options: {
  readonly refs?: Record<string, unknown>
  readonly run: RunMutation
}): RuntimeDeferredStorePort {
  const ref = (name: string): unknown => {
    const value = options.refs?.[name]
    if (value) return value
    throw missingDeferredComponentError()
  }

  return {
    getScope: async (scopeId, read) => {
      const result = await options.run<unknown>(ref('getScope'), {
        scopeId,
        namespace: read.namespace,
      })
      return result ? decodeDeferredScope(result) : null
    },
    createScope: async (scope) => {
      const result = await options.run<unknown>(ref('createScope'), {
        scope: encodeDeferredScope(scope),
      })
      return decodeDeferredScope(result)
    },
    putScope: (scope) =>
      options
        .run(ref('putScope'), { scope: encodeDeferredScope(scope) })
        .then(noop),
    listScopes: async (query) =>
      (
        await options.run<readonly unknown[]>(ref('listScopes'), {
          ...query,
          leaseExpiresBefore: query.leaseExpiresBefore?.getTime(),
        })
      ).map(decodeDeferredScope),
    getIntent: async (intentId, read) => {
      const result = await options.run<unknown>(ref('getIntent'), {
        intentId,
        namespace: read.namespace,
      })
      return result ? decodeDeferredIntent(result) : null
    },
    createIntent: async (intent) => {
      const result = await options.run<unknown>(ref('createIntent'), {
        intent: encodeDeferredIntent(intent),
      })
      return decodeDeferredIntent(result)
    },
    putIntent: (intent) =>
      options
        .run(ref('putIntent'), { intent: encodeDeferredIntent(intent) })
        .then(noop),
    listIntents: async (query) =>
      (
        await options.run<readonly unknown[]>(ref('listIntents'), { ...query })
      ).map(decodeDeferredIntent),
  }
}

/** Fail before a named composite reaches an out-of-date deployed component. */
export function assertConvexDeferredComponent(
  refs: Record<string, unknown> | undefined,
): void {
  if (refs) return
  throw missingDeferredComponentError()
}

function missingDeferredComponentError() {
  return createRuntimeError({
    code: 'SETUP_REQUIRED',
    whatFailed:
      'Convex Runtime Engine component does not support durable deferred intents.',
    why: 'The deployed component predates the runtime.deferred storage contract.',
    whatStillWorks:
      'Existing Runtime work, flows, events, timers, and inline non-durable APIs remain available.',
    nextStep:
      'Upgrade @use-crux/convex and redeploy the generated Convex component before using defer(target, input).',
  })
}

function noop(): void {}
