import type {
  DurableEffectEnvelopeRecord,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRecord,
  DurableEffectReconciliationSettlement,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoveryFailureSettlement,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnavailableSettlement,
  DurableEffectRecoveryUnitRecord,
} from '@use-crux/core/runtime'
import {
  durableTransitionMatches,
  isDurableReceiptTransition,
  isDurableReconciliationReceiptTransition,
  isDurableReconciliationUnitTransition,
  isDurableRecoveryUnavailableReceiptTransition,
  isDurableRecoveryUnavailableUnitTransition,
  isDurableUnitTransition,
} from '@use-crux/core/runtime/internal/effects-store'
import type { PostgresStoreFaults } from './faults'
import {
  getEffectRecord,
  insertEffectRecord,
  listEffectRecords,
  replaceEffectRecord,
} from './effect-records'
import type { PgExecutor } from './sql'

export async function preparePostgresEffectRecovery(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  preparation: DurableEffectRecoveryPreparation,
): Promise<DurableEffectRecoveryPreparation | null> {
  const currentUnit = await getEffectRecord<DurableEffectRecoveryUnitRecord>(
    db, records, 'unit', preparation.unit.namespace,
    preparation.unit.unit.id, true,
  )
  if (
    !currentUnit ||
    !durableTransitionMatches(currentUnit, preparation.unit) ||
    !isDurableUnitTransition(
      currentUnit.unit.status,
      preparation.unit.unit.status,
    )
  ) return null
  if (!(await insertEffectRecord(
    db, records, 'attempt', preparation.attempt.attemptReceiptId,
    preparation.receipt.receipt.boundaryId, preparation.attempt, faults,
  ))) return null
  if (!(await insertEffectRecord(
    db, records, 'receipt', preparation.receipt.receipt.id,
    preparation.receipt.receipt.boundaryId, preparation.receipt, faults,
  ))) return null
  if (!(await replaceEffectRecord(
    db, records, 'unit', preparation.unit.unit.id,
    preparation.unit.unit.boundaryId, currentUnit.revision,
    preparation.unit, faults,
  ))) return null
  return preparation
}

export async function settlePostgresEffectRecovery(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  settlement: DurableEffectRecoverySettlement,
): Promise<DurableEffectRecoverySettlement | null> {
  const attempt = await getEffectRecord<DurableEffectReceiptRecord>(
    db, records, 'receipt', settlement.attemptReceipt.namespace,
    settlement.attemptReceipt.receipt.id, true,
  )
  const original = await getEffectRecord<DurableEffectReceiptRecord>(
    db, records, 'receipt', settlement.originalReceipt.namespace,
    settlement.originalReceipt.receipt.id, true,
  )
  const unit = await getEffectRecord<DurableEffectRecoveryUnitRecord>(
    db, records, 'unit', settlement.unit.namespace,
    settlement.unit.unit.id, true,
  )
  if (
    !attempt || !original || !unit ||
    !durableTransitionMatches(attempt, settlement.attemptReceipt) ||
    !durableTransitionMatches(original, settlement.originalReceipt) ||
    !durableTransitionMatches(unit, settlement.unit) ||
    !isDurableReceiptTransition(
      attempt.receipt.outcome,
      settlement.attemptReceipt.receipt.outcome,
    ) ||
    !isDurableUnitTransition(unit.unit.status, settlement.unit.unit.status)
  ) return null
  if (!(await replaceEffectRecord(
    db, records, 'receipt', settlement.attemptReceipt.receipt.id,
    settlement.attemptReceipt.receipt.boundaryId, attempt.revision,
    settlement.attemptReceipt, faults,
  ))) return null
  if (!(await replaceEffectRecord(
    db, records, 'receipt', settlement.originalReceipt.receipt.id,
    settlement.originalReceipt.receipt.boundaryId, original.revision,
    settlement.originalReceipt, faults,
  ))) return null
  if (!(await replaceEffectRecord(
    db, records, 'unit', settlement.unit.unit.id,
    settlement.unit.unit.boundaryId, unit.revision, settlement.unit, faults,
  ))) return null
  return settlement
}

export async function settlePostgresEffectRecoveryFailure(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  settlement: DurableEffectRecoveryFailureSettlement,
): Promise<DurableEffectRecoveryFailureSettlement | null> {
  const attempt = await getEffectRecord<DurableEffectReceiptRecord>(
    db, records, 'receipt', settlement.attemptReceipt.namespace,
    settlement.attemptReceipt.receipt.id, true,
  )
  const unit = await getEffectRecord<DurableEffectRecoveryUnitRecord>(
    db, records, 'unit', settlement.unit.namespace,
    settlement.unit.unit.id, true,
  )
  if (
    !attempt || !unit ||
    !durableTransitionMatches(attempt, settlement.attemptReceipt) ||
    !durableTransitionMatches(unit, settlement.unit) ||
    !isDurableReceiptTransition(
      attempt.receipt.outcome,
      settlement.attemptReceipt.receipt.outcome,
    ) ||
    !isDurableUnitTransition(unit.unit.status, settlement.unit.unit.status)
  ) return null
  if (!(await replaceEffectRecord(
    db, records, 'receipt', settlement.attemptReceipt.receipt.id,
    settlement.attemptReceipt.receipt.boundaryId, attempt.revision,
    settlement.attemptReceipt, faults,
  ))) return null
  if (!(await replaceEffectRecord(
    db, records, 'unit', settlement.unit.unit.id,
    settlement.unit.unit.boundaryId, unit.revision, settlement.unit, faults,
  ))) return null
  return settlement
}

export async function settlePostgresEffectRecoveryUnavailable(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  settlement: DurableEffectRecoveryUnavailableSettlement,
): Promise<DurableEffectRecoveryUnavailableSettlement | null> {
  const receipt = await getEffectRecord<DurableEffectReceiptRecord>(
    db, records, 'receipt', settlement.receipt.namespace,
    settlement.receipt.receipt.id, true,
  )
  const unit = await getEffectRecord<DurableEffectRecoveryUnitRecord>(
    db, records, 'unit', settlement.unit.namespace,
    settlement.unit.unit.id, true,
  )
  if (
    !receipt || !unit ||
    !durableTransitionMatches(receipt, settlement.receipt) ||
    !durableTransitionMatches(unit, settlement.unit) ||
    !isDurableRecoveryUnavailableReceiptTransition(
      receipt.receipt, settlement.receipt.receipt,
    ) ||
    !isDurableRecoveryUnavailableUnitTransition(
      unit.unit.status, settlement.unit.unit.status,
    )
  ) return null
  if (!(await replaceEffectRecord(
    db, records, 'receipt', settlement.receipt.receipt.id,
    settlement.receipt.receipt.boundaryId, receipt.revision,
    settlement.receipt, faults,
  ))) return null
  if (!(await replaceEffectRecord(
    db, records, 'unit', settlement.unit.unit.id,
    settlement.unit.unit.boundaryId, unit.revision, settlement.unit, faults,
  ))) return null
  return settlement
}

export async function reconcilePostgresEffects(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  settlement: DurableEffectReconciliationSettlement,
): Promise<DurableEffectReconciliationSettlement | null> {
  const targetId = settlement.reconciliation.receiptId
  const currentReceipts: DurableEffectReceiptRecord[] = []
  for (const next of settlement.receipts) {
    const current = await getEffectRecord<DurableEffectReceiptRecord>(
      db, records, 'receipt', next.namespace, next.receipt.id, true,
    )
    if (!current) return null
    currentReceipts.push(current)
  }
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
  const target = currentReceipts.find((record) => record.receipt.id === targetId)
  if (!target) return null
  const audits = await listEffectRecords<DurableEffectReconciliationRecord>(
    db, records, 'reconciliation', settlement.reconciliation.namespace,
    target.receipt.boundaryId,
  )
  if (!reconciliationMatches(
    settlement, currentReceipts, currentUnit, currentEnvelope, audits,
  )) return null
  for (const [index, receipt] of settlement.receipts.entries()) {
    if (!(await replaceEffectRecord(
      db, records, 'receipt', receipt.receipt.id, receipt.receipt.boundaryId,
      currentReceipts[index]!.revision, receipt, faults,
    ))) return null
  }
  if (settlement.unit && currentUnit && !(await replaceEffectRecord(
    db, records, 'unit', settlement.unit.unit.id,
    settlement.unit.unit.boundaryId, currentUnit.revision,
    settlement.unit, faults,
  ))) return null
  if (settlement.envelope && currentEnvelope && !(await replaceEffectRecord(
    db, records, 'envelope', settlement.envelope.receiptId,
    target.receipt.boundaryId, currentEnvelope.revision,
    settlement.envelope, faults,
  ))) return null
  if (!(await insertEffectRecord(
    db, records, 'reconciliation',
    `${targetId}:${settlement.reconciliation.revision}`,
    target.receipt.boundaryId, settlement.reconciliation, faults,
  ))) return null
  return settlement
}

function reconciliationMatches(
  settlement: DurableEffectReconciliationSettlement,
  receipts: readonly DurableEffectReceiptRecord[],
  unit: DurableEffectRecoveryUnitRecord | null,
  envelope: DurableEffectEnvelopeRecord | null,
  audits: readonly DurableEffectReconciliationRecord[],
): boolean {
  const targetId = settlement.reconciliation.receiptId
  return !settlement.receipts.some((next, index) => {
    const current = receipts[index]
    return !current ||
      !durableTransitionMatches(current, next) ||
      !isDurableReconciliationReceiptTransition(
        current.receipt.outcome,
        next.receipt.outcome,
        next.receipt.id === targetId,
      )
  }) &&
    (!settlement.unit || Boolean(
      unit && durableTransitionMatches(unit, settlement.unit) &&
      isDurableReconciliationUnitTransition(
        unit.unit.status,
        settlement.unit.unit.status,
      ),
    )) &&
    (!settlement.envelope || Boolean(
      envelope && durableTransitionMatches(envelope, settlement.envelope),
    )) &&
    settlement.reconciliation.revision ===
      audits.filter((audit) => audit.receiptId === targetId).length + 1
}
