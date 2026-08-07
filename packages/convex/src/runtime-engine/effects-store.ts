import type { RuntimeEffectStorePort } from '@use-crux/core/runtime'
import { createRuntimeError } from '@use-crux/core/runtime'
import { decodeEffectValue, encodeEffectValue } from './codec'

interface ConvexEffectComponent {
  readonly run?: unknown
}

interface CreateConvexEffectStoreOptions {
  readonly refs: ConvexEffectComponent
  readonly run: <TResult>(
    ref: unknown,
    args: Record<string, unknown>,
  ) => Promise<TResult>
}

/** Construct a durable Effects facade over atomic component mutations. */
export function createConvexEffectStore(
  options: CreateConvexEffectStoreOptions,
): RuntimeEffectStorePort {
  const ref = requireRunReference(options.refs)
  const run = async <TResult>(
    operation: string,
    input: Record<string, unknown>,
  ): Promise<TResult> => decodeEffectValue<TResult>(
    await options.run(ref, {
      operation,
      input: encodeEffectValue(input),
    }),
  )
  return {
    claimRecoveryScopes: (value) => run('claimRecoveryScopes', {
      value: { ...value, now: value.now.getTime() },
    }),
    releaseRecoveryScope: (value) => run('releaseRecoveryScope', {
      value: { ...value, now: value.now.getTime() },
    }),
    getReceipt: (receiptId, read) =>
      run('getReceipt', { receiptId, options: read }),
    linkReceiptEvidence: (value) => run('linkReceiptEvidence', { value }),
    prepare: (value) => run('prepare', { value }),
    transitionReceipt: (value) => run('transitionReceipt', { value }),
    settleExecution: (value) => run('settleExecution', { value }),
    transitionScope: (value) => run('transitionScope', { value }),
    synchronizeScope: (value) => run('synchronizeScope', { value }),
    transitionUnit: (value) => run('transitionUnit', { value }),
    prepareRecovery: (value) => run('prepareRecovery', { value }),
    settleRecovery: (value) => run('settleRecovery', { value }),
    settleRecoveryFailure: (value) => run('settleRecoveryFailure', { value }),
    settleRecoveryUnavailable: (value) =>
      run('settleRecoveryUnavailable', { value }),
    reconcile: (value) => run('reconcile', { value }),
    reconstructScope: (scope, read) =>
      run('reconstructScope', { scope, options: read }),
    prune: (value) =>
      run('prune', {
        value: {
          ...value,
          before: value.before.getTime(),
          now: value.now.getTime(),
        },
      }),
  }
}

function requireRunReference(refs: ConvexEffectComponent): unknown {
  if (refs.run) return refs.run
  throw createRuntimeError({
    code: 'SETUP_REQUIRED',
    whatFailed: 'Convex Runtime Engine component is missing durable Effects operations.',
    why: 'Each logical Effects write must execute inside one component mutation.',
    whatStillWorks:
      'Runtime operations that do not execute durable Effects continue to work.',
    nextStep:
      'Regenerate or update the Crux Convex component so runtime.composite_effects.run is available.',
  })
}
