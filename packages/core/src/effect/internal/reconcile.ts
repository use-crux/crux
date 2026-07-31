/**
 * Unknown-outcome transitions for effect executions and recovery attempts.
 *
 * @internal
 * @module
 */

import { CruxEffectError } from "../errors";
import type { EffectReceipt, RecoveryAvailability } from "../receipt-types";
import type { EffectReceiptRef, EffectReconciliation } from "../types";
import { recordEffectReceiptReconciliation, recordEffectRecoveryReconciliation } from "./evidence";
import { isEffectJsonSafe } from "./json-safety";
import { effectLedger } from "./ledger";
import type { RegisteredRecoveryUnit, StoredRecoveryEnvelope } from "./recovery-stack";
export type LedgerReconciliation =
  | {
      readonly kind: "execution";
      readonly receiptId: string;
      readonly resolution: EffectReconciliation;
    }
  | {
      readonly kind: "recovery";
      readonly attemptReceiptId: string;
      readonly originalReceiptId: string;
      readonly unitId: string;
      readonly resolution: EffectReconciliation;
    };
export interface ReconciliationAudit {
  readonly receiptId: string;
  readonly outcome: EffectReconciliation["outcome"];
  readonly reason: string;
  readonly reconciledAt: number;
}
export interface ReconciliationLedgerState {
  getReceipt(id: string): EffectReceipt | undefined;
  getEnvelope(receiptId: string): StoredRecoveryEnvelope | undefined;
  getUnit(unitId: string): RegisteredRecoveryUnit | undefined;
  commit(change: ReconciliationCommit): void;
}
export interface ReconciliationCommit {
  readonly result: EffectReceipt;
  readonly receipts: readonly EffectReceipt[];
  readonly unit?: RegisteredRecoveryUnit;
  readonly envelope?: StoredRecoveryEnvelope;
  readonly discardUnit?: RegisteredRecoveryUnit;
  readonly audit: ReconciliationAudit;
}

export function commitLedgerReconciliation(
  command: LedgerReconciliation,
  state: ReconciliationLedgerState,
): EffectReceipt {
  const change =
    command.kind === "execution"
      ? executionReconciliation(command, state)
      : recoveryReconciliation(command, state);
  state.commit(change);
  return change.result;
}

function executionReconciliation(
  command: Extract<LedgerReconciliation, { readonly kind: "execution" }>,
  state: ReconciliationLedgerState,
): ReconciliationCommit {
  const receipt = unknownReceipt(command.receiptId, state);
  const unit = receipt.recoveryUnitId
    ? state.getUnit(receipt.recoveryUnitId)
    : undefined;
  if (
    unit &&
    (unit.kind !== "effect" || unit.status !== "prepared")
  ) {
    throw new TypeError(
      `Recovery unit \`${unit.id}\` is not prepared.`,
    );
  }
  const succeeded = command.resolution.outcome === "succeeded";
  const envelope = unit ? state.getEnvelope(receipt.id) : undefined;
  if (
    succeeded &&
    unit &&
    (!envelope ||
      envelope.effectId !== receipt.effectId ||
      envelope.effectVersion !== receipt.effectVersion)
  ) {
    throw new TypeError(
      `Effect receipt \`${receipt.id}\` has incompatible recovery state.`,
    );
  }
  const next = settleUnknownReceipt(
    receipt,
    command.resolution.outcome,
    succeeded ? (unit ? "available" : "irreversible") : "unavailable",
    succeeded ? unit?.id : undefined,
  );
  return {
    result: next,
    receipts: [next],
    ...(succeeded && unit && envelope
      ? {
          unit: Object.freeze({ ...unit, status: "active" }),
          envelope: Object.freeze({
            ...envelope,
            output: command.resolution.output,
          }),
        }
      : {}),
    ...(!succeeded && unit ? { discardUnit: unit } : {}),
    audit: reconciliationAudit(receipt.id, command),
  };
}

function recoveryReconciliation(
  command: Extract<LedgerReconciliation, { readonly kind: "recovery" }>,
  state: ReconciliationLedgerState,
): ReconciliationCommit {
  const attempt = unknownReceipt(command.attemptReceiptId, state);
  const original = state.getReceipt(command.originalReceiptId);
  const unit = state.getUnit(command.unitId);
  if (
    !original ||
    !unit ||
    unit.kind !== "effect" ||
    attempt.parentReceiptId !== original.id ||
    attempt.recoveryUnitId !== unit.id
  ) {
    throw new TypeError(
      `Recovery attempt \`${attempt.id}\` has incompatible state.`,
    );
  }
  const succeeded = command.resolution.outcome === "succeeded";
  const nextAttempt = settleUnknownReceipt(
    attempt,
    command.resolution.outcome,
    "unavailable",
    unit.id,
  );
  const nextOriginal = Object.freeze({
    ...original,
    recovery: succeeded ? "recovered" as const : "available" as const,
  });
  return {
    result: nextAttempt,
    receipts: [nextAttempt, nextOriginal],
    unit: Object.freeze({
      ...unit,
      status: succeeded ? "recovered" as const : "active" as const,
      recoveryOperation: undefined,
    }),
    audit: reconciliationAudit(attempt.id, command),
  };
}

function unknownReceipt(
  receiptId: string,
  state: ReconciliationLedgerState,
): EffectReceipt {
  const receipt = state.getReceipt(receiptId);
  if (!receipt || receipt.outcome !== "unknown") {
    throw new TypeError(
      `Effect receipt \`${receiptId}\` is not unknown.`,
    );
  }
  return receipt;
}

function settleUnknownReceipt(
  receipt: EffectReceipt, outcome: "succeeded" | "failed",
  recovery: RecoveryAvailability, recoveryUnitId?: string,
): EffectReceipt {
  const {
    error: discardedError,
    recoveryUnitId: discardedUnitId,
    ...settled
  } = receipt;
  void discardedError;
  void discardedUnitId;
  return Object.freeze({
    ...settled,
    outcome,
    recovery,
    ...(recoveryUnitId === undefined ? {} : { recoveryUnitId }),
  });
}

function reconciliationAudit(
  receiptId: string,
  command: LedgerReconciliation,
): ReconciliationAudit {
  return Object.freeze({
    receiptId,
    outcome: command.resolution.outcome,
    reason: command.resolution.reason,
    reconciledAt: Date.now(),
  });
}

export function reconcileEffectReceipt(
  reference: EffectReceiptRef,
  resolution: EffectReconciliation,
): EffectReceipt {
  const value: unknown = reference;
  if (
    !isRecord(value) ||
    value.kind !== "effect.receipt" ||
    typeof value.id !== "string" ||
    typeof value.effectId !== "string"
  ) {
    throw ambiguous("Effect receipt reference is invalid.");
  }
  const receipt = effectLedger.getReceipt(value.id);
  if (
    !receipt ||
    receipt.effectId !== value.effectId ||
    ("effectVersion" in value &&
      value.effectVersion !== receipt.effectVersion)
  ) {
    throw ambiguous(
      `Effect receipt \`${value.id}\` does not match its definition.`,
    );
  }
  const target =
    receipt.outcome === "unknown"
      ? receipt
      : findUnknownRecoveryAttempt(receipt);
  if (!target) {
    throw ambiguous(
      `Effect receipt \`${receipt.id}\` is not awaiting reconciliation.`,
    );
  }
  if (
    resolution.outcome === "succeeded" &&
    !isEffectJsonSafe(resolution.output)
  ) {
    throw ambiguous("Reconciliation output must be JSON-safe.");
  }
  if (target.parentReceiptId) {
    return reconcileRecoveryAttempt(receipt, target, resolution);
  }
  const settled = effectLedger.reconcile({
    kind: "execution",
    receiptId: target.id,
    resolution,
  });
  recordEffectReceiptReconciliation(settled);
  return settled;
}

function findUnknownRecoveryAttempt(receipt: EffectReceipt): EffectReceipt | undefined {
  if (receipt.recovery !== "ambiguous") return undefined;
  return effectLedger
    .receiptsFor(receipt.boundaryId)
    .find(
      (candidate) =>
        candidate.parentReceiptId === receipt.id &&
        candidate.outcome === "unknown",
    );
}

function reconcileRecoveryAttempt(
  requested: EffectReceipt,
  attempt: EffectReceipt,
  resolution: EffectReconciliation,
): EffectReceipt {
  const original = attempt.parentReceiptId
    ? effectLedger.getReceipt(attempt.parentReceiptId)
    : undefined;
  const unit = attempt.recoveryUnitId
    ? effectLedger.getUnit(attempt.recoveryUnitId)
    : undefined;
  if (!original || !unit || unit.kind !== "effect") {
    throw ambiguous(
      `Recovery attempt \`${attempt.id}\` has incompatible state.`,
    );
  }
  const settledAttempt = effectLedger.reconcile({
    kind: "recovery",
    attemptReceiptId: attempt.id,
    originalReceiptId: original.id,
    unitId: unit.id,
    resolution,
  });
  const settledOriginal = effectLedger.getReceipt(original.id) ?? original;
  recordEffectRecoveryReconciliation(settledOriginal, settledAttempt);
  return requested.id === attempt.id
    ? settledAttempt
    : settledOriginal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ambiguous(message: string): CruxEffectError {
  return new CruxEffectError({
    code: "EFFECT_OUTCOME_AMBIGUOUS",
    message,
  });
}
