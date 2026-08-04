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
import type { PostgresStoreFaults } from './faults'
import {
  getEffectRecord,
  insertEffectRecord,
  listEffectRecords,
  replaceEffectRecord,
} from './effect-records'
import type { PgExecutor } from './sql'
import { table } from './sql'
import {
  synchronizePostgresEffectScope,
  transitionPostgresEffectScope,
  transitionPostgresEffectUnit,
} from './effect-lifecycle'
import {
  preparePostgresEffectRecovery,
  reconcilePostgresEffects,
  settlePostgresEffectRecovery,
} from './effect-recovery'
import { prunePostgresEffectEnvelopes } from './effect-retention'

/** Create the PostgreSQL durable Effects record port. */
export function createPostgresEffectStore(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeEffectStorePort {
  const records = table(schema, 'effect_records')
  return {
    getReceipt: (receiptId, options) =>
      getEffectRecord(db, records, 'receipt', options.namespace, receiptId),

    async prepare(preparation) {
      const receiptId = preparation.receipt.receipt.id
      const inserted = await insertEffectRecord(
        db,
        records,
        'receipt',
        receiptId,
        preparation.receipt.receipt.boundaryId,
        preparation.receipt,
        faults,
      )
      if (!inserted) return await existingPreparation(db, records, preparation)

      const scopeId = preparation.scope.scope.ref.id
      const currentScope = await getEffectRecord<DurableEffectScopeRecord>(
        db,
        records,
        'scope',
        preparation.scope.namespace,
        scopeId,
        true,
      )
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
      if (currentScope) {
        await replaceEffectRecord(
          db,
          records,
          'scope',
          scopeId,
          scopeId,
          currentScope.revision,
          scope,
          faults,
        )
      } else {
        await insertEffectRecord(
          db,
          records,
          'scope',
          scopeId,
          scopeId,
          scope,
          faults,
        )
      }
      if (preparation.unit) {
        await insertEffectRecord(
          db,
          records,
          'unit',
          preparation.unit.unit.id,
          preparation.unit.unit.boundaryId,
          { ...preparation.unit, revision: 1 },
          faults,
        )
      }
      if (preparation.envelope) {
        await insertEffectRecord(
          db,
          records,
          'envelope',
          preparation.envelope.receiptId,
          preparation.receipt.receipt.boundaryId,
          { ...preparation.envelope, revision: 1 },
          faults,
        )
      }
      return { ...preparation, scope, receipt: { ...preparation.receipt, revision: 1 } }
    },

    async transitionReceipt({ next }) {
      const current = await getEffectRecord<DurableEffectReceiptRecord>(
        db,
        records,
        'receipt',
        next.namespace,
        next.receipt.id,
        true,
      )
      if (
        !current ||
        !durableTransitionMatches(current, next) ||
        !isDurableReceiptTransition(current.receipt.outcome, next.receipt.outcome)
      ) return null
      return await replaceEffectRecord(
        db,
        records,
        'receipt',
        next.receipt.id,
        next.receipt.boundaryId,
        current.revision,
        next,
        faults,
      ) ? next : null
    },

    async linkReceiptEvidence(link) {
      const current = await getEffectRecord<DurableEffectReceiptRecord>(
        db, records, 'receipt', link.namespace, link.receiptId, true,
      )
      if (!current) return null
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
        db,
        records,
        'receipt',
        current.receipt.id,
        current.receipt.boundaryId,
        current.revision,
        next,
        faults,
      ) ? next : null
    },

    async settleExecution(settlement) {
      const currentReceipt = await getEffectRecord<DurableEffectReceiptRecord>(
        db, records, 'receipt', settlement.receipt.namespace,
        settlement.receipt.receipt.id, true,
      )
      const currentUnit = settlement.unit
        ? await getEffectRecord<DurableEffectRecoveryUnitRecord>(
            db, records, 'unit', settlement.unit.namespace,
            settlement.unit.unit.id, true,
          )
        : null
      const currentEnvelope = settlement.envelope
        ? await getEffectRecord<DurableEffectEnvelopeRecord>(
            db, records, 'envelope', settlement.envelope.namespace,
            settlement.envelope.receiptId, true,
          )
        : null
      if (
        !currentReceipt ||
        !durableTransitionMatches(currentReceipt, settlement.receipt) ||
        !isDurableReceiptTransition(
          currentReceipt.receipt.outcome,
          settlement.receipt.receipt.outcome,
        ) ||
        (settlement.unit &&
          (!currentUnit ||
            !durableTransitionMatches(currentUnit, settlement.unit) ||
            !isDurableUnitTransition(
              currentUnit.unit.status,
              settlement.unit.unit.status,
            ))) ||
        (settlement.envelope &&
          (!currentEnvelope ||
            !durableTransitionMatches(currentEnvelope, settlement.envelope)))
      ) return null
      if (!(await replaceEffectRecord(
        db, records, 'receipt', settlement.receipt.receipt.id,
        settlement.receipt.receipt.boundaryId, currentReceipt.revision,
        settlement.receipt, faults,
      ))) return null
      if (settlement.unit && currentUnit) {
        if (!(await replaceEffectRecord(
          db, records, 'unit', settlement.unit.unit.id,
          settlement.unit.unit.boundaryId, currentUnit.revision,
          settlement.unit, faults,
        ))) return null
      }
      if (settlement.envelope && currentEnvelope && !(await replaceEffectRecord(
        db, records, 'envelope', settlement.envelope.receiptId,
        settlement.receipt.receipt.boundaryId, currentEnvelope.revision,
        settlement.envelope, faults,
      ))) {
        return null
      }
      return settlement
    },

    transitionScope: (transition) =>
      transitionPostgresEffectScope(db, records, faults, transition),
    synchronizeScope: (synchronization) =>
      synchronizePostgresEffectScope(db, records, faults, synchronization),
    transitionUnit: (transition) =>
      transitionPostgresEffectUnit(db, records, faults, transition),
    prepareRecovery: (preparation) =>
      preparePostgresEffectRecovery(db, records, faults, preparation),
    settleRecovery: (settlement) =>
      settlePostgresEffectRecovery(db, records, faults, settlement),
    reconcile: (settlement) =>
      reconcilePostgresEffects(db, records, faults, settlement),

    async reconstructScope(scope, options) {
      const scopeRecord = await getEffectRecord<DurableEffectScopeRecord>(
        db, records, 'scope', options.namespace, scope.id,
      )
      if (!scopeRecord || scopeRecord.scope.ref.runId !== scope.runId) return null
      const [receipts, units, envelopes, attempts, reconciliations] =
        await Promise.all([
          listEffectRecords<DurableEffectReceiptRecord>(
            db, records, 'receipt', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectRecoveryUnitRecord>(
            db, records, 'unit', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectEnvelopeRecord>(
            db, records, 'envelope', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectRecoveryAttemptRecord>(
            db, records, 'attempt', options.namespace, scope.id,
          ),
          listEffectRecords<DurableEffectReconciliationRecord>(
            db, records, 'reconciliation', options.namespace, scope.id,
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
      return prunePostgresEffectEnvelopes(db, records, faults, options)
    },
  }
}

async function existingPreparation(
  db: PgExecutor,
  records: string,
  requested: Parameters<RuntimeEffectStorePort['prepare']>[0],
) {
  const receipt = await getEffectRecord<DurableEffectReceiptRecord>(
    db, records, 'receipt', requested.receipt.namespace,
    requested.receipt.receipt.id, true,
  )
  const scope = await getEffectRecord<DurableEffectScopeRecord>(
    db, records, 'scope', requested.scope.namespace,
    requested.scope.scope.ref.id, true,
  )
  if (!receipt || !scope) throw new TypeError('Durable Effect preparation is incomplete.')
  const unit = requested.unit
    ? await getEffectRecord<DurableEffectRecoveryUnitRecord>(
        db, records, 'unit', requested.unit.namespace, requested.unit.unit.id,
      )
    : undefined
  const envelope = requested.envelope
    ? await getEffectRecord<DurableEffectEnvelopeRecord>(
        db, records, 'envelope', requested.envelope.namespace,
        requested.envelope.receiptId,
      )
    : undefined
  return { scope, receipt, unit: unit ?? undefined, envelope: envelope ?? undefined }
}
