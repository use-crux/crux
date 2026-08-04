/** Durable operations exposed by the Effect ledger. @internal @module */

import type { EffectScopeRef } from "../types";
import {
  hasDurableEffectStore,
  linkDurableEffectReceiptEvidence as linkReceiptEvidence,
  linkDurableEffectReceiptRetryCount as linkReceiptRetryCount,
  persistDurableReceiptTransition as persistReceipt,
  persistDurableUnitTransition as persistUnit,
  prepareDurableEffectExecution as prepareExecution,
  restoreDurableEffectScope as restoreScope,
  restoreDurableEffectReceiptScope as restoreReceiptScope,
  settleDurableEffectExecution as settleExecution,
  type DurableLedgerCache,
} from "./durable-ledger";
import { effectLedger } from "./ledger";
import { persistDurableScopeTransition as persistScope } from "./durable-scope";
import {
  prepareDurableRecoveryAttempt as prepareRecovery,
  settleDurableRecoveryAttempt as settleRecovery,
} from "./durable-recovery";

const cache: DurableLedgerCache = {
  getReceipt: effectLedger.getReceipt,
  getEnvelope: effectLedger.getEnvelope,
  getUnit: effectLedger.getUnit,
  getScope: effectLedger.getScope,
  stackFor: effectLedger.stackFor,
  restore: effectLedger.restoreDurableSnapshot,
};

export const hasDurableEffectLedger = hasDurableEffectStore;

/** Persist one prepared occurrence atomically through the active store. */
export function prepareDurableEffectExecution(input: {
  readonly receiptId: string;
  readonly executionIdempotencyKey: string;
  readonly recoveryUnitId?: string;
}): Promise<void> {
  return prepareExecution(cache, input);
}

/** Persist the current receipt lifecycle through the active store. */
export function persistDurableReceiptTransition(
  receiptId: string,
): Promise<void> {
  return persistReceipt(cache, receiptId);
}

/** Append canonical tool-outcome evidence to a settled durable receipt. */
export function linkDurableEffectReceiptEvidence(
  receiptId: string,
  ref: import("../../evidence/subjects").EvidenceArtifactRef,
): Promise<void> {
  return linkReceiptEvidence(receiptId, ref);
}

/** Update a receipt from the final retry count inspected after SDK settlement. */
export function linkDurableEffectReceiptRetryCount(
  receiptId: string,
  requestRetryCount: number,
): Promise<void> {
  return linkReceiptRetryCount(receiptId, requestRetryCount);
}

/** Atomically settle one successful durable occurrence. */
export function settleDurableEffectExecution(
  receiptId: string,
): Promise<void> {
  return settleExecution(cache, receiptId);
}

/** Persist one recovery-unit lifecycle transition. */
export function persistDurableRecoveryUnitTransition(
  unitId: string,
): Promise<void> {
  return persistUnit(cache, unitId);
}

/** Atomically persist a recovery attempt before compensation starts. */
export function prepareDurableEffectRecovery(input: {
  readonly attemptReceiptId: string;
  readonly originalReceiptId: string;
  readonly unitId: string;
}): Promise<void> {
  return prepareRecovery(cache, input);
}

/** Atomically settle a successful recovery attempt. */
export function settleDurableEffectRecovery(input: {
  readonly attemptReceiptId: string;
  readonly originalReceiptId: string;
  readonly unitId: string;
}): Promise<void> {
  return settleRecovery(cache, input);
}

/** Persist one rollback-scope lifecycle transition. */
export function persistDurableEffectScopeTransition(
  scopeId: string,
): Promise<void> {
  return persistScope(cache, scopeId);
}

/** Refresh one rollback scope from the configured Runtime store. */
export function restoreDurableEffectScope(
  scope: EffectScopeRef,
): Promise<boolean> {
  return restoreScope(cache, scope);
}

/** Refresh the durable scope containing one receipt. */
export function restoreDurableEffectReceiptScope(
  receiptId: string,
): Promise<boolean> {
  return restoreReceiptScope(cache, receiptId);
}
