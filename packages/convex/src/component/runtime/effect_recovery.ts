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
import type { MutationCtx } from '../_generated/server.js'
import {
  getEffectDocument,
  insertEffectRecord,
  listEffectRecords,
  replaceEffectRecord,
} from './effect_records'

export async function prepareEffectRecovery(
  ctx: MutationCtx,
  preparation: DurableEffectRecoveryPreparation,
): Promise<DurableEffectRecoveryPreparation | null> {
  const unitDocument = await getEffectDocument(
    ctx, 'unit', preparation.unit.namespace, preparation.unit.unit.id,
  )
  const unit = unitDocument?.record as DurableEffectRecoveryUnitRecord | undefined
  if (!unitDocument || !unit ||
    !durableTransitionMatches(unit, preparation.unit) ||
    !isDurableUnitTransition(unit.unit.status, preparation.unit.unit.status)) {
    return null
  }
  if (!(await insertEffectRecord(
    ctx, 'attempt', preparation.attempt.attemptReceiptId,
    preparation.receipt.receipt.boundaryId, preparation.attempt,
  ))) return null
  if (!(await insertEffectRecord(
    ctx, 'receipt', preparation.receipt.receipt.id,
    preparation.receipt.receipt.boundaryId, preparation.receipt,
  ))) return null
  if (!(await replaceEffectRecord(
    ctx, unitDocument, preparation.unit.unit.boundaryId, preparation.unit,
  ))) return null
  return preparation
}

export async function settleEffectRecovery(
  ctx: MutationCtx,
  settlement: DurableEffectRecoverySettlement,
): Promise<DurableEffectRecoverySettlement | null> {
  const attemptDocument = await getEffectDocument(
    ctx, 'receipt', settlement.attemptReceipt.namespace,
    settlement.attemptReceipt.receipt.id,
  )
  const originalDocument = await getEffectDocument(
    ctx, 'receipt', settlement.originalReceipt.namespace,
    settlement.originalReceipt.receipt.id,
  )
  const unitDocument = await getEffectDocument(
    ctx, 'unit', settlement.unit.namespace, settlement.unit.unit.id,
  )
  const attempt = attemptDocument?.record as DurableEffectReceiptRecord | undefined
  const original = originalDocument?.record as DurableEffectReceiptRecord | undefined
  const unit = unitDocument?.record as DurableEffectRecoveryUnitRecord | undefined
  if (!attemptDocument || !originalDocument || !unitDocument ||
    !attempt || !original || !unit ||
    !durableTransitionMatches(attempt, settlement.attemptReceipt) ||
    !durableTransitionMatches(original, settlement.originalReceipt) ||
    !durableTransitionMatches(unit, settlement.unit) ||
    !isDurableReceiptTransition(
      attempt.receipt.outcome,
      settlement.attemptReceipt.receipt.outcome,
    ) ||
    !isDurableUnitTransition(unit.unit.status, settlement.unit.unit.status)) {
    return null
  }
  if (!(await replaceEffectRecord(
    ctx, attemptDocument, settlement.attemptReceipt.receipt.boundaryId,
    settlement.attemptReceipt,
  ))) return null
  if (!(await replaceEffectRecord(
    ctx, originalDocument, settlement.originalReceipt.receipt.boundaryId,
    settlement.originalReceipt,
  ))) return null
  if (!(await replaceEffectRecord(
    ctx, unitDocument, settlement.unit.unit.boundaryId, settlement.unit,
  ))) return null
  return settlement
}

export async function settleEffectRecoveryFailure(
  ctx: MutationCtx,
  settlement: DurableEffectRecoveryFailureSettlement,
): Promise<DurableEffectRecoveryFailureSettlement | null> {
  const attemptDocument = await getEffectDocument(
    ctx, 'receipt', settlement.attemptReceipt.namespace,
    settlement.attemptReceipt.receipt.id,
  )
  const unitDocument = await getEffectDocument(
    ctx, 'unit', settlement.unit.namespace, settlement.unit.unit.id,
  )
  const attempt = attemptDocument?.record as DurableEffectReceiptRecord | undefined
  const unit = unitDocument?.record as DurableEffectRecoveryUnitRecord | undefined
  if (
    !attemptDocument || !unitDocument || !attempt || !unit ||
    !durableTransitionMatches(attempt, settlement.attemptReceipt) ||
    !durableTransitionMatches(unit, settlement.unit) ||
    !isDurableReceiptTransition(
      attempt.receipt.outcome,
      settlement.attemptReceipt.receipt.outcome,
    ) ||
    !isDurableUnitTransition(unit.unit.status, settlement.unit.unit.status)
  ) return null
  if (!(await replaceEffectRecord(
    ctx, attemptDocument, settlement.attemptReceipt.receipt.boundaryId,
    settlement.attemptReceipt,
  ))) return null
  if (!(await replaceEffectRecord(
    ctx, unitDocument, settlement.unit.unit.boundaryId, settlement.unit,
  ))) return null
  return settlement
}

export async function settleEffectRecoveryUnavailable(
  ctx: MutationCtx,
  settlement: DurableEffectRecoveryUnavailableSettlement,
): Promise<DurableEffectRecoveryUnavailableSettlement | null> {
  const receiptDocument = await getEffectDocument(
    ctx, 'receipt', settlement.receipt.namespace,
    settlement.receipt.receipt.id,
  )
  const unitDocument = await getEffectDocument(
    ctx, 'unit', settlement.unit.namespace, settlement.unit.unit.id,
  )
  const receipt = receiptDocument?.record as DurableEffectReceiptRecord | undefined
  const unit = unitDocument?.record as DurableEffectRecoveryUnitRecord | undefined
  if (
    !receiptDocument || !unitDocument || !receipt || !unit ||
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
    ctx, receiptDocument, settlement.receipt.receipt.boundaryId,
    settlement.receipt,
  ))) return null
  if (!(await replaceEffectRecord(
    ctx, unitDocument, settlement.unit.unit.boundaryId, settlement.unit,
  ))) return null
  return settlement
}

export async function reconcileEffects(
  ctx: MutationCtx,
  settlement: DurableEffectReconciliationSettlement,
): Promise<DurableEffectReconciliationSettlement | null> {
  const targetId = settlement.reconciliation.receiptId
  const receiptDocuments = []
  for (const receipt of settlement.receipts) {
    const document = await getEffectDocument(
      ctx, 'receipt', receipt.namespace, receipt.receipt.id,
    )
    if (!document) return null
    receiptDocuments.push(document)
  }
  const receipts = receiptDocuments.map(
    (document) => document.record as DurableEffectReceiptRecord,
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
  const target = receipts.find((record) => record.receipt.id === targetId)
  if (!target) return null
  const audits = await listEffectRecords<DurableEffectReconciliationRecord>(
    ctx, 'reconciliation', settlement.reconciliation.namespace,
    target.receipt.boundaryId,
  )
  const unit = unitDocument?.record as DurableEffectRecoveryUnitRecord | undefined
  const envelope = envelopeDocument?.record as DurableEffectEnvelopeRecord | undefined
  if (!matchesReconciliation(settlement, receipts, unit, envelope, audits)) {
    return null
  }
  for (const [index, receipt] of settlement.receipts.entries()) {
    if (!(await replaceEffectRecord(
      ctx, receiptDocuments[index]!, receipt.receipt.boundaryId, receipt,
    ))) return null
  }
  if (settlement.unit && unitDocument && !(await replaceEffectRecord(
    ctx, unitDocument, settlement.unit.unit.boundaryId, settlement.unit,
  ))) return null
  if (settlement.envelope && envelopeDocument && !(await replaceEffectRecord(
    ctx, envelopeDocument, target.receipt.boundaryId, settlement.envelope,
  ))) return null
  if (!(await insertEffectRecord(
    ctx, 'reconciliation', `${targetId}:${settlement.reconciliation.revision}`,
    target.receipt.boundaryId, settlement.reconciliation,
  ))) return null
  return settlement
}

function matchesReconciliation(
  settlement: DurableEffectReconciliationSettlement,
  receipts: readonly DurableEffectReceiptRecord[],
  unit: DurableEffectRecoveryUnitRecord | undefined,
  envelope: DurableEffectEnvelopeRecord | undefined,
  audits: readonly DurableEffectReconciliationRecord[],
): boolean {
  const targetId = settlement.reconciliation.receiptId
  return !settlement.receipts.some((next, index) => {
    const current = receipts[index]
    return !current || !durableTransitionMatches(current, next) ||
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
