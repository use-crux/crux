import type {
  DurableEffectEnvelopeRecord,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  RuntimeEffectStorePort,
} from '@use-crux/core/runtime'
import {
  durableTransitionMatches,
  isDurableReceiptTransition,
  isDurableUnitTransition,
  reconstructDurableEffectScope,
} from '@use-crux/core/runtime/internal/effects-store'
import type { MutationCtx } from '../_generated/server.js'
import {
  getEffectDocument,
  getEffectRecord,
  insertEffectRecord,
  listEffectRecords,
  replaceEffectRecord,
} from './effect_records'
import {
  synchronizeEffectScope,
  transitionEffectScope,
  transitionEffectUnit,
} from './effect_lifecycle'
import {
  prepareEffectRecovery,
  reconcileEffects,
  settleEffectRecovery,
} from './effect_recovery'
import { pruneEffectEnvelopes } from './effect_retention'

/** Construct the durable Effects port inside one Convex component mutation. */
export function createComponentEffectStore(
  ctx: MutationCtx,
): RuntimeEffectStorePort {
  return {
    getReceipt: (receiptId, options) =>
      getEffectRecord(ctx, 'receipt', options.namespace, receiptId),

    async prepare(preparation) {
      const receiptId = preparation.receipt.receipt.id
      if (!(await insertEffectRecord(
        ctx, 'receipt', receiptId, preparation.receipt.receipt.boundaryId,
        preparation.receipt,
      ))) return await existingPreparation(ctx, preparation)
      const scopeId = preparation.scope.scope.ref.id
      const scopeDocument = await getEffectDocument(
        ctx, 'scope', preparation.scope.namespace, scopeId,
      )
      const currentScope = scopeDocument?.record as
        | DurableEffectScopeRecord
        | undefined
      const scope = currentScope
        ? {
            ...currentScope,
            scope: {
              ...currentScope.scope,
              unitIds: preparation.scope.scope.unitIds,
            },
            revision: currentScope.revision + 1,
          }
        : { ...preparation.scope, revision: 1 }
      const scopeStored = scopeDocument
        ? await replaceEffectRecord(ctx, scopeDocument, scopeId, scope)
        : await insertEffectRecord(ctx, 'scope', scopeId, scopeId, scope)
      if (!scopeStored) throw new TypeError('Durable Effect scope was rejected.')
      if (preparation.unit) {
        await insertEffectRecord(
          ctx, 'unit', preparation.unit.unit.id,
          preparation.unit.unit.boundaryId,
          { ...preparation.unit, revision: 1 },
        )
      }
      if (preparation.envelope) {
        await insertEffectRecord(
          ctx, 'envelope', preparation.envelope.receiptId,
          preparation.receipt.receipt.boundaryId,
          { ...preparation.envelope, revision: 1 },
        )
      }
      return {
        ...preparation,
        scope,
        receipt: { ...preparation.receipt, revision: 1 },
      }
    },

    async transitionReceipt({ next }) {
      const document = await getEffectDocument(
        ctx, 'receipt', next.namespace, next.receipt.id,
      )
      const current = document?.record as DurableEffectReceiptRecord | undefined
      if (!document || !current ||
        !durableTransitionMatches(current, next) ||
        !isDurableReceiptTransition(
          current.receipt.outcome,
          next.receipt.outcome,
        )) return null
      return await replaceEffectRecord(
        ctx, document, next.receipt.boundaryId, next,
      ) ? next : null
    },

    async linkReceiptEvidence(link) {
      const document = await getEffectDocument(
        ctx,
        'receipt',
        link.namespace,
        link.receiptId,
      )
      const current = document?.record as DurableEffectReceiptRecord | undefined
      if (!document || !current) return null
      if (
        current.receipt.toolOutcomeRef &&
        link.toolOutcomeRef &&
        current.receipt.toolOutcomeRef.id !== link.toolOutcomeRef.id
      ) {
        return null
      }
      const requestRetryCount = Math.max(
        current.receipt.requestRetryCount ?? 0,
        link.requestRetryCount ?? 0,
      )
      const changed =
        (!current.receipt.toolOutcomeRef && link.toolOutcomeRef !== undefined) ||
        requestRetryCount !== (current.receipt.requestRetryCount ?? 0)
      if (!changed) return current
      if (current.revision !== link.revision) return null
      const next = {
        ...current,
        receipt: {
          ...current.receipt,
          ...(link.toolOutcomeRef ? { toolOutcomeRef: link.toolOutcomeRef } : {}),
          ...(link.requestRetryCount === undefined ? {} : { requestRetryCount }),
        },
        revision: current.revision + 1,
      }
      return await replaceEffectRecord(
        ctx,
        document,
        current.receipt.boundaryId,
        next,
      ) ? next : null
    },

    async settleExecution(settlement) {
      const receiptDocument = await getEffectDocument(
        ctx, 'receipt', settlement.receipt.namespace,
        settlement.receipt.receipt.id,
      )
      const unitDocument = settlement.unit
        ? await getEffectDocument(
            ctx, 'unit', settlement.unit.namespace, settlement.unit.unit.id,
          )
        : null
      const envelopeDocument = settlement.envelope
        ? await getEffectDocument(
            ctx, 'envelope', settlement.envelope.namespace,
            settlement.envelope.receiptId,
          )
        : null
      const receipt = receiptDocument?.record as DurableEffectReceiptRecord | undefined
      const unit = unitDocument?.record as DurableEffectRecoveryUnitRecord | undefined
      const envelope = envelopeDocument?.record as
        | DurableEffectEnvelopeRecord
        | undefined
      if (!receiptDocument || !receipt ||
        !durableTransitionMatches(receipt, settlement.receipt) ||
        !isDurableReceiptTransition(
          receipt.receipt.outcome,
          settlement.receipt.receipt.outcome,
        ) ||
        (settlement.unit && (!unit ||
          !durableTransitionMatches(unit, settlement.unit) ||
          !isDurableUnitTransition(
            unit.unit.status,
            settlement.unit.unit.status,
          ))) ||
        (settlement.envelope && (!envelope ||
          !durableTransitionMatches(envelope, settlement.envelope)))) return null
      if (!(await replaceEffectRecord(
        ctx, receiptDocument, settlement.receipt.receipt.boundaryId,
        settlement.receipt,
      ))) return null
      if (settlement.unit && unitDocument && !(await replaceEffectRecord(
        ctx, unitDocument, settlement.unit.unit.boundaryId, settlement.unit,
      ))) return null
      if (settlement.envelope && envelopeDocument && !(await replaceEffectRecord(
        ctx, envelopeDocument, settlement.receipt.receipt.boundaryId,
        settlement.envelope,
      ))) return null
      return settlement
    },

    transitionScope: (transition) => transitionEffectScope(ctx, transition),
    synchronizeScope: (value) => synchronizeEffectScope(ctx, value),
    transitionUnit: (transition) => transitionEffectUnit(ctx, transition),
    prepareRecovery: (value) => prepareEffectRecovery(ctx, value),
    settleRecovery: (value) => settleEffectRecovery(ctx, value),
    reconcile: (value) => reconcileEffects(ctx, value),

    async reconstructScope(scope, options) {
      const scopeRecord = await getEffectRecord<DurableEffectScopeRecord>(
        ctx, 'scope', options.namespace, scope.id,
      )
      if (!scopeRecord || scopeRecord.scope.ref.runId !== scope.runId) return null
      const [receipts, units, envelopes, attempts, reconciliations] =
        await Promise.all([
          listEffectRecords<DurableEffectReceiptRecord>(
            ctx, 'receipt', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectRecoveryUnitRecord>(
            ctx, 'unit', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectEnvelopeRecord>(
            ctx, 'envelope', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectRecoveryAttemptRecord>(
            ctx, 'attempt', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectReconciliationRecord>(
            ctx, 'reconciliation', options.namespace, scope.id,
          ),
        ])
      return reconstructDurableEffectScope(scope, {
        scope: scopeRecord,
        receipts,
        units,
        envelopes,
        attempts,
        reconciliations,
      })
    },

    async prune(options) {
      return pruneEffectEnvelopes(ctx, options)
    },
  }
}

async function existingPreparation(
  ctx: MutationCtx,
  requested: Parameters<RuntimeEffectStorePort['prepare']>[0],
) {
  const receipt = await getEffectRecord<DurableEffectReceiptRecord>(
    ctx, 'receipt', requested.receipt.namespace, requested.receipt.receipt.id,
  )
  const scope = await getEffectRecord<DurableEffectScopeRecord>(
    ctx, 'scope', requested.scope.namespace, requested.scope.scope.ref.id,
  )
  if (!receipt || !scope) throw new TypeError('Durable Effect preparation is incomplete.')
  const unit = requested.unit
    ? await getEffectRecord<DurableEffectRecoveryUnitRecord>(
        ctx, 'unit', requested.unit.namespace, requested.unit.unit.id,
      )
    : undefined
  const envelope = requested.envelope
    ? await getEffectRecord<DurableEffectEnvelopeRecord>(
        ctx, 'envelope', requested.envelope.namespace,
        requested.envelope.receiptId,
      )
    : undefined
  return { scope, receipt, unit: unit ?? undefined, envelope: envelope ?? undefined }
}
