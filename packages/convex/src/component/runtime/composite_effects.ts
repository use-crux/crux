import type {
  RuntimeEffectReadOptions,
  RuntimeEffectRecoveryClaimOptions,
  RuntimeEffectRecoveryRelease,
  RuntimeEffectReceiptEvidenceLink,
  RuntimeEffectReceiptTransition,
  RuntimeEffectScopeTransition,
  RuntimeEffectUnitTransition,
} from '@use-crux/core/runtime'
import type {
  DurableEffectPreparation,
  DurableEffectReconciliationSettlement,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoveryFailureSettlement,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnavailableSettlement,
  DurableEffectScopeSynchronization,
  RuntimeEffectPruneOptions,
} from '@use-crux/core/runtime'
import type { EffectScopeRef } from '@use-crux/core/effect'
import { v } from 'convex/values'
import { decodeEffectValue, encodeEffectValue } from '../../runtime-engine/codec'
import { mutation } from '../_generated/server.js'
import { createComponentEffectStore } from './effects'

type EffectOperation =
  | 'claimRecoveryScopes'
  | 'getReceipt'
  | 'linkReceiptEvidence'
  | 'prepare'
  | 'prepareRecovery'
  | 'prune'
  | 'reconcile'
  | 'reconstructScope'
  | 'releaseRecoveryScope'
  | 'settleExecution'
  | 'settleRecovery'
  | 'settleRecoveryFailure'
  | 'settleRecoveryUnavailable'
  | 'synchronizeScope'
  | 'transitionReceipt'
  | 'transitionScope'
  | 'transitionUnit'

/** Run one logical Effects store operation as one Convex mutation. */
export const run = mutation({
  args: { operation: v.string(), input: v.any() },
  returns: v.any(),
  handler: async (ctx, { operation, input }) => {
    const store = createComponentEffectStore(ctx)
    const value = decodeEffectValue<Record<string, unknown>>(input)
    const result = await runOperation(store, assertOperation(operation), value)
    return encodeEffectValue(result)
  },
})

async function runOperation(
  store: ReturnType<typeof createComponentEffectStore>,
  operation: EffectOperation,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (operation) {
    case 'claimRecoveryScopes':
      return await store.claimRecoveryScopes(
        decodeClaimOptions(input.value),
      )
    case 'getReceipt':
      return await store.getReceipt(
        input.receiptId as string,
        input.options as RuntimeEffectReadOptions,
      )
    case 'prepare':
      return await store.prepare(input.value as DurableEffectPreparation)
    case 'linkReceiptEvidence':
      return await store.linkReceiptEvidence(
        input.value as RuntimeEffectReceiptEvidenceLink,
      )
    case 'transitionReceipt':
      return await store.transitionReceipt(
        input.value as RuntimeEffectReceiptTransition,
      )
    case 'settleExecution':
      return await store.settleExecution(
        input.value as Parameters<typeof store.settleExecution>[0],
      )
    case 'transitionScope':
      return await store.transitionScope(input.value as RuntimeEffectScopeTransition)
    case 'synchronizeScope':
      return await store.synchronizeScope(
        input.value as DurableEffectScopeSynchronization,
      )
    case 'transitionUnit':
      return await store.transitionUnit(input.value as RuntimeEffectUnitTransition)
    case 'prepareRecovery':
      return await store.prepareRecovery(
        input.value as DurableEffectRecoveryPreparation,
      )
    case 'settleRecovery':
      return await store.settleRecovery(
        input.value as DurableEffectRecoverySettlement,
      )
    case 'settleRecoveryFailure':
      return await store.settleRecoveryFailure(
        input.value as DurableEffectRecoveryFailureSettlement,
      )
    case 'settleRecoveryUnavailable':
      return await store.settleRecoveryUnavailable(
        input.value as DurableEffectRecoveryUnavailableSettlement,
      )
    case 'reconcile':
      return await store.reconcile(
        input.value as DurableEffectReconciliationSettlement,
      )
    case 'prune':
      return await store.prune(decodePruneOptions(input.value))
    case 'reconstructScope':
      return await store.reconstructScope(
        input.scope as EffectScopeRef,
        input.options as RuntimeEffectReadOptions,
      )
    case 'releaseRecoveryScope':
      return await store.releaseRecoveryScope(
        decodeRelease(input.value),
      )
  }
}

function assertOperation(value: string): EffectOperation {
  if (EFFECT_OPERATIONS.includes(value as EffectOperation)) {
    return value as EffectOperation
  }
  throw new Error(`Unknown durable Effects operation \`${value}\`.`)
}

const EFFECT_OPERATIONS: readonly EffectOperation[] = [
  'claimRecoveryScopes',
  'getReceipt',
  'linkReceiptEvidence',
  'prepare',
  'prepareRecovery',
  'prune',
  'reconcile',
  'reconstructScope',
  'releaseRecoveryScope',
  'settleExecution',
  'settleRecovery',
  'settleRecoveryFailure',
  'settleRecoveryUnavailable',
  'synchronizeScope',
  'transitionReceipt',
  'transitionScope',
  'transitionUnit',
]

function decodeClaimOptions(value: unknown): RuntimeEffectRecoveryClaimOptions {
  const options = value as Omit<RuntimeEffectRecoveryClaimOptions, 'now'> & {
    readonly now: number
  }
  return { ...options, now: new Date(options.now) }
}

function decodeRelease(value: unknown): RuntimeEffectRecoveryRelease {
  const release = value as Omit<RuntimeEffectRecoveryRelease, 'now'> & {
    readonly now: number
  }
  return { ...release, now: new Date(release.now) }
}

function decodePruneOptions(value: unknown): RuntimeEffectPruneOptions {
  const options = value as Omit<RuntimeEffectPruneOptions, 'before' | 'now'> & {
    readonly before: number
    readonly now: number
  }
  return {
    ...options,
    before: new Date(options.before),
    now: new Date(options.now),
  }
}
